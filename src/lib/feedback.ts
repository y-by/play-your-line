// "Send feedback": the call that sends a report (what is checked and attached is in feedbackInfo.ts).
import { supabase } from "./supabaseClient";
import { prepareCoverImage } from "./coverImage";
import { feedbackProblem } from "./feedbackInfo";

export interface FeedbackInput {
  userId: string;
  message: string;
  screenshot?: File | Blob | null;
  projectId: string | null;
  page: string;
  appBuild: string;
  device: string;
}

/**
 * Sends a report. The picture (shrunk to a JPEG) is uploaded first; if that fails the text is still sent and `pictureFailed`
 * says so. If the text cannot be saved, the picture is removed again so nothing is left behind.
 */
export async function sendFeedback(input: FeedbackInput): Promise<{ pictureFailed: boolean }> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const problem = feedbackProblem(input.message);
  if (problem) throw new Error(problem);
  const id = crypto.randomUUID();
  let path: string | null = null;
  let pictureFailed = false;
  if (input.screenshot) {
    try {
      const file = input.screenshot instanceof File ? input.screenshot : new File([input.screenshot], "screenshot", { type: input.screenshot.type });
      const jpeg = await prepareCoverImage(file, 1800);
      path = `${input.userId}/${id}.jpg`;
      const { error } = await supabase.storage.from("feedback").upload(path, jpeg, { contentType: "image/jpeg", upsert: false });
      if (error) throw error;
    } catch (err) {
      console.error("The report's picture could not be sent:", err);
      path = null;
      pictureFailed = true;
    }
  }
  const { error } = await supabase.from("feedback").insert({
    id,
    user_id: input.userId,
    message: input.message.trim(),
    screenshot_path: path,
    project_id: input.projectId,
    page: input.page,
    app_build: input.appBuild,
    device: input.device,
  });
  if (error) {
    if (path) await supabase.storage.from("feedback").remove([path]).catch(() => undefined);
    throw error;
  }
  return { pictureFailed };
}
