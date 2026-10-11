# Tomás portrait: provenance

- **What:** portrait of Tomás, Vitrina's AI assistant. It depicts a person who does not exist. No real person is depicted, and no photo of any real person was used as input (text prompt only).
- **Always shown with** the label «Asistente IA de Vitrina» and, under 40 px, the «IA» badge; accessible name «Tomás, asistente IA de Vitrina».
- **Tool / model:** Google Gemini 3 Pro Image (Nano Banana Pro) through treg (endpoint `reapi.image-gen.gemini-3-pro-image`), 2K, 1:1.
- **Date:** 2026-10-11. **Cost:** US$0.03 for the chosen image (US$0.24 for all six candidates; c1 chosen by José).
- **Task id:** `task_01a1291faee7741293266d5751bc4cd6`.
- **Prompt:** "Natural photographic headshot portrait of a warm, friendly Latin American man around 35 years old, short dark brown hair, light stubble, neutral relaxed expression with a very slight closed-mouth smile, looking at the camera. Head and shoulders, centered, wearing a plain solid heather-gray crew-neck sweater with no logos or text. Plain seamless cream background, color #FAF5ED. Soft diffused window light coming from the left, gentle shadow on the right side of the face, shot on a 85mm lens, natural skin texture, realistic, no retouching look, no text, no watermark."
- **Files:** `source-2048.jpg` (original as returned), `tomas-512.jpg` (master), `tomas-96.avif` / `tomas-64.avif` / `tomas-40.avif` (72% centered crop), `tomas-wa-640.jpg` (WhatsApp profile crop). Regenerate with the crop script (`magick`): crop 72% of the frame centered at 50%/46%, Lanczos resize, AVIF quality 60.
- **Open checks (José):** two team members confirm the portrait resembles nobody on the team; WhatsApp profile picture set on Vitrina's number.
