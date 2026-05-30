/**
 * Generate photorealistic vertical images via Google AI Studio (Gemini 2.5 Flash / Nano Banana 2).
 *
 * Usage:
 *   1. Set GOOGLE_GENAI_API_KEY in .env.local
 *   2. node scripts/generate-vertical-images.mjs
 *   3. Images saved to public/images/verticals/
 */

import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "public", "images", "verticals");

// Load .env.local
const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const API_KEY = process.env.GOOGLE_GENAI_API_KEY;
if (!API_KEY) {
  console.error("Missing GOOGLE_GENAI_API_KEY in .env.local");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

const verticals = [
  {
    id: "hvac",
    prompt:
      "Professional photograph of an HVAC technician servicing a large commercial air conditioning unit on a building rooftop. Warm golden hour sunlight, shallow depth of field, the technician wears a clean uniform with tool belt. Modern equipment, professional composition. Shot on Canon EOS R5, 85mm lens, f/2.8. Photorealistic, high resolution, no text or watermarks.",
  },
  {
    id: "roofing",
    prompt:
      "Professional photograph of a roofing contractor installing new asphalt shingles on a residential home. Clear blue sky with a few clouds, warm natural sunlight. Worker wearing safety harness and hard hat. Wide angle shot showing the roof slope and surrounding suburban neighborhood. Shot on Sony A7III, 24mm lens, f/8. Photorealistic, high resolution, no text or watermarks.",
  },
  {
    id: "auto",
    prompt:
      "Professional photograph of a modern auto body shop interior. A sleek sedan is on a hydraulic lift being worked on by a mechanic in a clean uniform. Bright LED workshop lighting, organized tools on the wall, polished concrete floor. Clean and professional workspace. Shot on Nikon Z9, 35mm lens, f/4. Photorealistic, high resolution, no text or watermarks.",
  },
  {
    id: "remodeling",
    prompt:
      "Professional photograph of a skilled painter applying a fresh coat of paint to a modern home interior wall with a roller. Natural light streaming through large windows, drop cloths on hardwood floor, paint cans nearby. Clean bright workspace, contemporary home with white trim. Shot on Canon EOS R5, 50mm lens, f/2.8. Photorealistic, high resolution, no text or watermarks.",
  },
];

fs.mkdirSync(OUT_DIR, { recursive: true });

async function generateImage(vertical) {
  const outPath = path.join(OUT_DIR, `${vertical.id}.jpg`);

  if (fs.existsSync(outPath)) {
    console.log(`  Skipping ${vertical.id} (already exists)`);
    return;
  }

  console.log(`  Generating ${vertical.id}...`);

  try {
    // Gemini 2.5 Flash Image (Nano Banana 2) — primary
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: vertical.prompt,
      config: {
        responseModalities: ["image", "text"],
      },
    });

    if (response.candidates?.[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          const mimeType = part.inlineData.mimeType || "image/jpeg";
          const ext = mimeType.includes("png") ? ".png" : ".jpg";
          const finalPath = outPath.replace(".jpg", ext);
          fs.writeFileSync(finalPath, Buffer.from(part.inlineData.data, "base64"));
          console.log(`  Saved ${vertical.id}${ext}`);
          return;
        }
      }
    }
    console.log(`  No image returned for ${vertical.id}`);
  } catch (err) {
    console.error(`  Failed for ${vertical.id}: ${err.message}`);
  }
}

console.log("Generating vertical images via Gemini 2.5 Flash Image...\n");

for (const v of verticals) {
  await generateImage(v);
}

console.log("\nDone!");
