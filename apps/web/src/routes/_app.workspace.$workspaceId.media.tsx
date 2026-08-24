import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { api } from "~/lib/api";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { colors, fontSizes, spacing } from "../styles/tokens.stylex";

interface MediaRow {
  id: string;
  mediaType: string;
  originalFilename: string;
  storageKey: string;
  url: string;
  fileSizeBytes: number;
  altText: string;
  processingStatus: string;
}

export const Route = createFileRoute("/_app/workspace/$workspaceId/media")({
  component: MediaPage,
});

const styles = stylex.create({
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing[6],
  },
  title: { fontSize: fontSizes["2xl"], fontWeight: 700, color: colors.foreground },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: spacing[4],
  },
  thumbWrap: {
    aspectRatio: "4 / 3",
    backgroundColor: colors.muted,
    borderRadius: 8,
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing[2],
  },
  thumb: { width: "100%", height: "100%", objectFit: "cover" },
  icon: { fontSize: fontSizes["3xl"] },
  filename: {
    fontSize: fontSizes.xs,
    color: colors.foreground,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  meta: { fontSize: fontSizes.xs, color: colors.mutedForeground },
  actions: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: spacing[2] },
  uploadRow: { display: "flex", gap: spacing[3], marginBottom: spacing[6], alignItems: "center" },
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MediaPage() {
  const { workspaceId } = Route.useParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [altText, setAltText] = useState("");

  const mediaQuery = useQuery({
    queryKey: ["media", workspaceId],
    queryFn: () => api.get<{ results: MediaRow[] }>(`/api/app/workspaces/${workspaceId}/media`),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      // Multipart upload — browser sets the boundary; api helper not used here.
      const form = new FormData();
      form.set("file", Buffer.from(await file.arrayBuffer()) as unknown as string);
      form.set("filename", file.name);
      form.set("mimetype", file.type || "application/octet-stream");
      return fetch(`/api/app/workspaces/${workspaceId}/media/upload?altText=${encodeURIComponent(altText)}`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
    },
    onSuccess: () => {
      if (fileInputRef.current) fileInputRef.current.value = "";
      setAltText("");
      mediaQuery.refetch();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/api/app/workspaces/${workspaceId}/media/${id}`),
    onSuccess: () => mediaQuery.refetch(),
  });

  return (
    <div>
      <div {...stylex.props(styles.header)}>
        <h1 {...stylex.props(styles.title)}>Media Library</h1>
        <div {...stylex.props(styles.uploadRow)}>
          <input
            placeholder="Alt text"
            value={altText}
            onChange={(e) => setAltText(e.target.value)}
            style={{
              padding: spacing[2],
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: colors.border,
              borderRadius: spacing[1],
              fontSize: fontSizes.sm,
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/quicktime"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadMutation.mutate(file);
            }}
          />
          {uploadMutation.isPending && (
            <span style={{ fontSize: fontSizes.sm, color: colors.mutedForeground }}>Uploading…</span>
          )}
          {uploadMutation.isError && (
            <span style={{ fontSize: fontSizes.sm, color: colors.destructive }}>
              Upload failed — check the file type.
            </span>
          )}
        </div>
      </div>

      <div {...stylex.props(styles.grid)}>
        {(mediaQuery.data?.results ?? []).map((asset) => (
          <Card key={asset.id}>
            <div {...stylex.props(styles.thumbWrap)}>
              {asset.mediaType === "image" || asset.mediaType === "gif" ? (
                <img src={asset.url} alt={asset.altText} {...stylex.props(styles.thumb)} />
              ) : asset.mediaType === "video" ? (
                <span {...stylex.props(styles.icon)}>🎬</span>
              ) : (
                <span {...stylex.props(styles.icon)}>📄</span>
              )}
            </div>
            <div {...stylex.props(styles.filename)}>{asset.originalFilename}</div>
            <div {...stylex.props(styles.meta)}>
              {formatBytes(asset.fileSizeBytes)} · {asset.mediaType}
            </div>
            <div {...stylex.props(styles.actions)}>
              <a
                href={asset.url}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: fontSizes.xs, color: colors.primary }}
              >
                Open
              </a>
              <Button
                variant="ghost"
                onClick={() => deleteMutation.mutate(asset.id)}
                disabled={deleteMutation.isPending}
              >
                Delete
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {(mediaQuery.data?.results.length ?? 0) === 0 && !mediaQuery.isLoading && (
        <Card>Upload images or videos to build your library.</Card>
      )}
    </div>
  );
}
