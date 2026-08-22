import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/onboarding")({
  component: () => <div style={{ padding: 24 }}>Onboarding wizard — next pass.</div>,
});
