import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";

import { colors, fontSizes, spacing } from "../styles/tokens.stylex";
import { Card } from "../components/ui/card";

export const Route = createFileRoute("/_app/workspace/$workspaceId/calendar")({
  component: CalendarPage,
});

const styles = stylex.create({
  title: {
    fontSize: fontSizes["2xl"],
    fontWeight: 700,
    marginBottom: spacing[6],
    color: colors.foreground,
  },
});

function CalendarPage() {
  const { workspaceId } = Route.useParams();
  return (
    <div>
      <h1 {...stylex.props(styles.title)}>Calendar</h1>
      <Card>
        Calendar view for workspace {workspaceId} lands in the next frontend pass.
      </Card>
    </div>
  );
}
