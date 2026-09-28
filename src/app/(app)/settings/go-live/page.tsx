import { redirect } from "next/navigation";

/** The go-live plan is part of the one setup checklist now. */
export default function GoLivePage() {
  redirect("/setup");
}
