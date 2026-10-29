import { createFileRoute } from "@tanstack/react-router";
import App from "../client/App";

export const Route = createFileRoute("/")({
  component: App,
});
