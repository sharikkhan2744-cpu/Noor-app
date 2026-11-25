const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const { test, before, after, beforeEach } = require("node:test");
const fs = require("node:fs");

let testEnv;
const PROJECT_ID = process.env.GCP_PROJECT || "demo-no-project";
const ALICE_UID = "alice_uid_123";
const BOB_UID = "bob_uid_456";

const [emulatorHost, emulatorPortStr] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085").split(":");
const emulatorPort = parseInt(emulatorPortStr, 10);

before(async () => {
  const rules = fs.readFileSync("./firestore.rules", "utf8");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
      host: emulatorHost,
      port: emulatorPort,
    },
  });
});

after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

beforeEach(async () => {
  if (testEnv) {
    await testEnv.clearFirestore();
  }
});

function validProjectPayload(uid) {
  const now = new Date(Date.now() - 1000);
  return {
    userId: uid,
    title: "Andalusia Golden Age",
    projectType: "DOCUMENTARY",
    aspectRatio: "16:9",
    resolution: "1080p",
    targetDurationSec: 600,
    fps: 30,
    sacredProtection: true,
    islamicMode: true,
    status: "DRAFT",
    scriptText: "Introduction to Cordoba...",
    language: "English",
    favorite: false,
    sceneCount: 1,
    chapterCount: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function validScenePayload(uid, projectId) {
  const now = new Date(Date.now() - 1000);
  return {
    userId: uid,
    projectId: projectId,
    title: "Scene 1: Great Mosque",
    chapterTitle: "Chapter 1: Foundations",
    orderIndex: 0,
    narrationText: "In the heart of Cordoba...",
    visualPrompt: "Golden sunlit arches of Cordoba, wide cinematic shot",
    negativePrompt: "modern cars, faces",
    cameraMotion: "SLOW_ZOOM_IN",
    transitionType: "CROSSFADE",
    durationSec: 12,
    subtitleText: "In the heart of Cordoba...",
    status: "PENDING",
    createdAt: now,
    updatedAt: now,
  };
}

test("Unauthenticated user cannot read or write projects, media, bookmarks, settings, or exports", async () => {
  const unauthDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(unauthDb.collection("users").doc(ALICE_UID).collection("projects").get());
  await assertFails(
    unauthDb.collection("users").doc(ALICE_UID).collection("projects").doc("proj_1").set(validProjectPayload(ALICE_UID))
  );
  await assertFails(unauthDb.collection("users").doc(ALICE_UID).collection("media_assets").get());
  await assertFails(unauthDb.collection("users").doc(ALICE_UID).collection("bookmarks").get());
  await assertFails(unauthDb.collection("users").doc(ALICE_UID).collection("settings").get());
  await assertFails(unauthDb.collection("users").doc(ALICE_UID).collection("exports").get());
});

test("Cross-user isolation: Bob cannot read, list, update, or delete Alice's data", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("projects").doc("proj_1").set(validProjectPayload(ALICE_UID))
  );

  const bobDb = testEnv.authenticatedContext(BOB_UID).firestore();
  await assertFails(bobDb.collection("users").doc(ALICE_UID).collection("projects").get());
  await assertFails(bobDb.collection("users").doc(ALICE_UID).collection("projects").doc("proj_1").get());
  await assertFails(
    bobDb.collection("users").doc(ALICE_UID).collection("projects").doc("proj_1").update({ title: "Hijacked" })
  );
  await assertFails(bobDb.collection("users").doc(ALICE_UID).collection("projects").doc("proj_1").delete());
});

test("Owner can create, list, partially update, and delete project and nested scenes", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const projectsRef = aliceDb.collection("users").doc(ALICE_UID).collection("projects");

  // List empty collection must succeed
  await assertSucceeds(projectsRef.get());

  // Create project
  await assertSucceeds(projectsRef.doc("proj_1").set(validProjectPayload(ALICE_UID)));

  // Create scene under existing parent project
  const scenesRef = projectsRef.doc("proj_1").collection("scenes");
  await assertSucceeds(scenesRef.doc("scene_1").set(validScenePayload(ALICE_UID, "proj_1")));

  // Orphan scene under non-existent project must fail
  await assertFails(
    projectsRef.doc("missing_proj").collection("scenes").doc("scene_2").set(validScenePayload(ALICE_UID, "missing_proj"))
  );

  // Partial update on project preserving createdAt
  await assertSucceeds(
    projectsRef.doc("proj_1").update({
      title: "Andalusia Updated",
      favorite: true,
      updatedAt: new Date(Date.now() - 500),
    })
  );

  // Reject ghost fields and immutable createdAt overwrite
  await assertFails(
    projectsRef.doc("proj_1").update({
      isAdmin: true,
      updatedAt: new Date(Date.now() - 400),
    })
  );
  await assertFails(
    projectsRef.doc("proj_1").update({
      createdAt: new Date(Date.now() - 300),
      updatedAt: new Date(Date.now() - 300),
    })
  );
  // Reject @DocumentId `id` field inside document payload
  await assertFails(
    projectsRef.doc("proj_2").set({
      ...validProjectPayload(ALICE_UID),
      id: "proj_2",
    })
  );
});

test("Owner can manage media_assets, bookmarks, settings, and exports with strict bounds", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const now = new Date(Date.now() - 1000);

  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("media_assets").doc("asset_1").set({
      userId: ALICE_UID,
      title: "Cordoba Courtyard",
      assetType: "IMAGE",
      localPath: "/data/user/0/app/files/img1.png",
      mimeType: "image/png",
      aspectRatio: "16:9",
      durationSec: 0,
      sizeBytes: 245000,
      sourceProvider: "Firebase AI (Nano Banana 2.1)",
      licenseNote: "Generated by user via Firebase AI Logic",
      createdAt: now,
      updatedAt: now,
    })
  );

  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("bookmarks").doc("bm_1").set({
      userId: ALICE_UID,
      itemType: "QURAN_AYAH",
      collectionName: "Al-Fatihah",
      referenceKey: "1:1",
      arabicText: "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ",
      translationText: "In the name of Allah, the Entirely Merciful, the Especially Merciful.",
      sourceName: "AlQuran.cloud (Sahih International)",
      createdAt: now,
      updatedAt: now,
    })
  );

  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("settings").doc("preferences").set({
      userId: ALICE_UID,
      language: "English",
      defaultAspectRatio: "16:9",
      defaultResolution: "1080p",
      defaultDurationSec: 8,
      defaultVoice: "en-US-standard",
      subtitleFontSize: 18,
      subtitlePosition: "BOTTOM",
      sacredProtection: true,
      autoSave: true,
      offlineWifiOnly: false,
      updatedAt: now,
    })
  );

  await assertSucceeds(
    aliceDb.collection("users").doc(ALICE_UID).collection("exports").doc("exp_1").set({
      userId: ALICE_UID,
      projectId: "proj_1",
      projectTitle: "Andalusia Golden Age",
      format: "MP4",
      resolution: "1080p",
      durationSec: 12,
      localPath: "/data/user/0/app/files/exports/andalusia.mp4",
      status: "COMPLETED",
      createdAt: now,
    })
  );

  // Reject future timestamp tampering
  await assertFails(
    aliceDb.collection("users").doc(ALICE_UID).collection("bookmarks").doc("bm_future").set({
      userId: ALICE_UID,
      itemType: "QURAN_AYAH",
      collectionName: "Al-Baqarah",
      referenceKey: "2:255",
      arabicText: "اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ",
      translationText: "Allah - there is no deity except Him.",
      sourceName: "AlQuran.cloud",
      createdAt: new Date(Date.now() + 120000),
      updatedAt: new Date(Date.now() + 120000),
    })
  );

  // Notes create, update, cross-user fail, delete
  const notesRef = aliceDb.collection("users").doc(ALICE_UID).collection("notes");
  await assertSucceeds(
    notesRef.doc("note_1").set({
      userId: ALICE_UID,
      title: "Al-Fatihah Reflection",
      category: "QURAN",
      referenceKey: "1:1",
      content: "Opening invocation of mercy.",
      createdAt: now,
      updatedAt: now,
    })
  );
  await assertSucceeds(
    notesRef.doc("note_1").update({
      title: "Al-Fatihah Detailed Reflection",
      content: "Updated reflection text.",
      updatedAt: new Date(Date.now() - 400),
    })
  );
  const bobDb = testEnv.authenticatedContext(BOB_UID).firestore();
  await assertFails(bobDb.collection("users").doc(ALICE_UID).collection("notes").get());
  await assertSucceeds(notesRef.doc("note_1").delete());

  // Research history create and read
  const histRef = aliceDb.collection("users").doc(ALICE_UID).collection("research_history");
  await assertSucceeds(
    histRef.doc("hist_1").set({
      userId: ALICE_UID,
      query: "Treaty of Hudaybiyyah",
      entryType: "ISLAMIC_RESEARCH",
      summaryText: "Verified 6 AH historical treaty context.",
      sourcesText: "Sahih al-Bukhari, Surah Al-Fath",
      createdAt: now,
    })
  );
  await assertFails(
    histRef.doc("hist_1").update({ summaryText: "Tampered" })
  );
  await assertFails(bobDb.collection("users").doc(ALICE_UID).collection("research_history").get());
});

test("Extended project/scene fields, voice_profiles, ai_conversations/messages, and hadith_verifications rules", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const bobDb = testEnv.authenticatedContext(BOB_UID).firestore();
  const now = new Date(Date.now() - 1000);

  // Extended project + scene
  const projRef = aliceDb.collection("users").doc(ALICE_UID).collection("projects").doc("proj_ext");
  await assertSucceeds(
    projRef.set({
      ...validProjectPayload(ALICE_UID),
      stylePreset: "ANIME",
      colorShadePreset: "GOLDEN",
      selectedVoiceId: "vp_1",
      selectedVoiceName: "Scholarly Urdu",
      renderedVideoPath: "/data/exports/test.mp4",
      colorGradeJson: '{"brightness":0.03}',
      subtitleStyleJson: '{"fontSizeSp":24}',
      musicPreset: "Desert Wind Drone",
      voiceVolume: 1.0,
      musicVolume: 0.35,
    })
  );
  await assertSucceeds(
    projRef.collection("scenes").doc("sc_ext").set({
      ...validScenePayload(ALICE_UID, "proj_ext"),
      mediaType: "VIDEO",
      videoPath: "/data/media/clip.mp4",
      trimStartMs: 0,
      trimEndMs: 5000,
      rotationDeg: 90,
      cropSpec: "CENTER_16_9",
      scaleFactor: 1.2,
      volume: 1.0,
      fadeInMs: 300,
      fadeOutMs: 300,
      colorGradeJson: '{"contrast":1.1}',
      textOverlay: "Al-Andalus",
      voiceProfileId: "vp_1",
    })
  );

  // Unlimited voice_profiles create, rename update, and cross-user denial
  const voicesRef = aliceDb.collection("users").doc(ALICE_UID).collection("voice_profiles");
  await assertSucceeds(
    voicesRef.doc("vp_1").set({
      userId: ALICE_UID,
      name: "Clear Urdu Documentary",
      language: "Urdu",
      category: "Documentary",
      description: "Warm archival narration voice",
      sampleAudioPath: "/data/media/v1.wav",
      providerType: "USER_UPLOAD",
      externalVoiceId: "",
      pitch: 1.0,
      speed: 1.0,
      favorite: true,
      createdAt: now,
      updatedAt: now,
    })
  );
  await assertSucceeds(
    voicesRef.doc("vp_1").update({
      name: "Renamed Urdu Voice",
      updatedAt: new Date(Date.now() - 400),
    })
  );
  await assertFails(bobDb.collection("users").doc(ALICE_UID).collection("voice_profiles").get());

  // AI Conversations + nested messages
  const convRef = aliceDb.collection("users").doc(ALICE_UID).collection("ai_conversations").doc("conv_1");
  await assertSucceeds(
    convRef.set({
      userId: ALICE_UID,
      title: "Bukhari 2812 Check",
      modelId: "gpt-4o-mini",
      lastMessagePreview: "Explain Sahih al-Bukhari 2812",
      messageCount: 1,
      createdAt: now,
      updatedAt: now,
    })
  );
  await assertSucceeds(
    convRef.collection("messages").doc("m_1").set({
      userId: ALICE_UID,
      conversationId: "conv_1",
      role: "USER",
      content: "Explain Sahih al-Bukhari #2812",
      citationsText: "Sahih al-Bukhari #2812",
      modelUsed: "gpt-4o-mini",
      createdAt: now,
    })
  );
  await assertFails(convRef.collection("messages").doc("m_1").update({ content: "Edited" }));
  await assertFails(bobDb.collection("users").doc(ALICE_UID).collection("ai_conversations").get());

  // Hadith Truth Shield record
  const hvRef = aliceDb.collection("users").doc(ALICE_UID).collection("hadith_verifications").doc("hv_1");
  await assertSucceeds(
    hvRef.set({
      userId: ALICE_UID,
      projectId: "proj_ext",
      originalPrompt: "Story mentioning Sahih al-Bukhari 1",
      verifiedClaim: "Actions are judged by intentions (Bukhari #1)",
      verificationEvidence: "Matched Sahih al-Bukhari #1 (Sahih)",
      correctedNarration: "Confirmed narration matching primary text",
      finalScript: "Deeds are by intentions...",
      status: "AUTHENTIC",
      createdAt: now,
    })
  );
  await assertFails(hvRef.update({ status: "UNVERIFIED" }));
  await assertFails(bobDb.collection("users").doc(ALICE_UID).collection("hadith_verifications").get());
});

