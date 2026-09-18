import { redirect } from "next/navigation";

// Ask is the first destination and the one a trainee opens with a question.
export default function Home() {
  redirect("/ask");
}
