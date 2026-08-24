import { Injectable } from "@nestjs/common";

import { GRAPH_BASE_URL, graphGet, graphPost } from "../publisher/providers/meta-graph.client";

/**
 * Port of apps/inbox/tasks.py + legacy provider get_messages/reply_to_message.
 * Shared by Facebook, Instagram and Threads — they all use Graph API
 * conversations endpoints with slightly different parameters.
 */

export interface InboxMessageRow {
  platformMessageId: string;
  senderPlatformId: string;
  senderName: string;
  body: string;
  receivedAt: Date;
  conversationId?: string;
}

@Injectable()
export class InboxGraphHelper {
  /// GET /{pageId}/conversations → for each, GET /{convoId}/messages
  async fetchMetaConversations(
    accessToken: string,
    pageOrIgUserId: string,
    since?: Date,
  ): Promise<InboxMessageRow[]> {
    const params = new URLSearchParams({
      fields: "id,messages{id,message,from,created_time}",
    });
    if (since) params.set("since", String(Math.floor(since.getTime() / 1000)));

    const convosRes = await graphGet(
      `${GRAPH_BASE_URL}/${pageOrIgUserId}/conversations`,
      accessToken,
      Object.fromEntries(params),
    );

    const results: InboxMessageRow[] = [];
    const conversations =
      ((convosRes["data"] as Array<Record<string, unknown>>) ?? []);

    for (const convo of conversations) {
      const convoId = String(convo["id"]);
      const fields = "id,message,from{name,id},created_time";
      try {
        const msgsRes = await graphGet(
          `${GRAPH_BASE_URL}/${convoId}/messages`,
          accessToken,
          { fields },
        );
        for (const msg of ((msgsRes["data"] as Array<Record<string, unknown>>) ?? [])) {
          const from = (msg["from"] ?? {}) as Record<string, unknown>;
          results.push({
            platformMessageId: String(msg["id"]),
            senderPlatformId: String(from["id"] ?? ""),
            senderName: String(from["name"] ?? ""),
            body: String(msg["message"] ?? ""),
            receivedAt: new Date(String(msg["created_time"])),
            conversationId: convoId,
          });
        }
      } catch {
        // Skip conversations we can't read (legacy parity)
      }
    }
    return results;
  }

  async sendMetaReply(
    accessToken: string,
    conversationId: string,
    text: string,
  ): Promise<{ platformReplyId: string }> {
    const data = await graphPost(
      `${GRAPH_BASE_URL}/${conversationId}/messages`,
      accessToken,
      { message: text },
    );
    return { platformReplyId: String(data["id"]) };
  }

  async postCommentAsPage(
    accessToken: string,
    postId: string,
    message: string,
  ): Promise<{ platformCommentId: string }> {
    const data = await graphPost(`${GRAPH_BASE_URL}/${postId}/comments`, accessToken, {
      message,
    });
    return { platformCommentId: String(data["id"]) };
  }
}
