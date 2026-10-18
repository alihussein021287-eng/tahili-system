import { redirect } from "next/navigation";

// "مساحاتي" repeated the home page's shortcuts and role cards; the home page is the one place now.
export default function WorkspacesPage() {
  redirect("/");
}
