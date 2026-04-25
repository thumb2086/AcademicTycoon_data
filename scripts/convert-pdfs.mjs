import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { createCanvas, ImageData } from "@napi-rs/canvas";
import sharp from "sharp";

globalThis.DOMMatrix =
  globalThis.DOMMatrix ||
  class DOMMatrix {
    constructor(init = [1, 0, 0, 1, 0, 0]) {
      [this.a, this.b, this.c, this.d, this.e, this.f] = init;
    }
    clone() { return new globalThis.DOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]); }
    multiplySelf() { return this; }
    multiply() { return this.clone(); }
    preMultiplySelf() { return this; }
    translateSelf(x = 0, y = 0) { this.e += x; this.f += y; return this; }
    translate(x = 0, y = 0) { return this.clone().translateSelf(x, y); }
    scaleSelf(x = 1, y = x) { this.a *= x; this.d *= y; return this; }
    scale(x = 1, y = x) { return this.clone().scaleSelf(x, y); }
    rotateSelf() { return this; }
    rotate() { return this.clone(); }
    invertSelf() { return this; }
    transformPoint(point) { return point; }
  };
globalThis.ImageData = globalThis.ImageData || ImageData;

const { getDocument, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");

const ROOT = process.cwd();
const RAW_BASE = "https://raw.githubusercontent.com/thumb2086/AcademicTycoon_data/main";
const QUESTION_JSON_ROOT = path.join(ROOT, "question_jsons");
const CONTENT_JSON_ROOT = path.join(ROOT, "content_jsons");
const MOCK_EXAM_JSON_DIR = path.join(QUESTION_JSON_ROOT, "mock_exams");
const TCK_EXAM_JSON_DIR = path.join(QUESTION_JSON_ROOT, "tck_past_exams");
const TEXTBOOK_EXERCISE_JSON_DIR = path.join(QUESTION_JSON_ROOT, "textbook_exercises");
const TEXTBOOK_CONTENT_JSON_DIR = path.join(CONTENT_JSON_ROOT, "textbooks");
const OUTPUT_IMAGE_DIR = path.join(ROOT, "assets", "question_images");
const OUTPUT_CONTENT_IMAGE_DIR = path.join(ROOT, "assets", "content_pages");
const TEMP_DIR = path.join(ROOT, ".codex-tmp", "pdf-conversion");
const OCR_QUEUE_DIR = path.join(TEMP_DIR, "ocr-queue");
const OCR_SCRIPT = path.join(ROOT, "scripts", "ocr-images.ps1");
const CONFIG_PATH = path.join(ROOT, "config.json");
const PDFJS_CMAP_DIR = path.join(ROOT, "node_modules", "pdfjs-dist", "cmaps");
const PDFJS_STANDARD_FONT_DIR = path.join(ROOT, "node_modules", "pdfjs-dist", "standard_fonts");
const PDFJS_WASM_DIR = path.join(ROOT, "node_modules", "pdfjs-dist", "wasm");
const PDFJS_CMAP_URL = `${PDFJS_CMAP_DIR.replaceAll(path.sep, "/")}/`;
const PDFJS_STANDARD_FONT_URL = `${PDFJS_STANDARD_FONT_DIR.replaceAll(path.sep, "/")}/`;
const PDFJS_WASM_URL = `${PDFJS_WASM_DIR.replaceAll(path.sep, "/")}/`;
const POWERSHELL_EXE = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe"
);

const BOOK_CODE_MAP = new Map([
  ["mechanical_manufacturing", "mech_mfg"],
  ["機械製造", "mech_mfg"],
  ["mechanical_mechanics", "mech_mechanics"],
  ["機械力學", "mech_mechanics"],
  ["mechanical_basic_practice", "mech_basic_practice"],
  ["機械基礎實習全冊", "mech_basic_practice"],
  ["mechanical_drafting", "mech_drafting"],
  ["機械製圖", "mech_drafting"],
  ["mechanical_manufacturing_workbook", "mech_mfg_workbook"],
  ["機械製造鍛鍊本", "mech_mfg_workbook"],
  ["machine_elements_upper_ppt", "machine_elements_upper"],
  ["技術型高中機械群機件原理上冊_PPT", "machine_elements_upper"],
  ["machine_elements_lower_ppt", "machine_elements_lower"],
  ["技術型高中機械群機件原理下冊_PPT", "machine_elements_lower"]
]);

const BOOK_DISPLAY_MAP = new Map([
  ["mechanical_manufacturing", "機械製造"],
  ["mechanical_mechanics", "機械力學"],
  ["mechanical_basic_practice", "機械基礎實習全冊"],
  ["mechanical_drafting", "機械製圖"],
  ["mechanical_manufacturing_workbook", "機械製造鍛鍊本"],
  ["machine_elements_upper_ppt", "技術型高中機械群機件原理上冊_PPT"],
  ["machine_elements_lower_ppt", "技術型高中機械群機件原理下冊_PPT"]
]);

const SUBJECT_CODE_MAP = [
  ["機械群專一", "ME1"],
  ["機械群專二", "ME2"],
  ["數學(C)", "MATC"],
  ["數學_C_", "MATC"],
  ["數學", "MATH"],
  ["國文", "CHI"],
  ["英文", "ENG"],
  ["外語群英文類專二", "FL2"]
];

const args = parseArgs(process.argv.slice(2));

await fs.mkdir(OUTPUT_IMAGE_DIR, { recursive: true });
await fs.mkdir(OUTPUT_CONTENT_IMAGE_DIR, { recursive: true });
await fs.mkdir(TEMP_DIR, { recursive: true });
await fs.mkdir(OCR_QUEUE_DIR, { recursive: true });
await fs.mkdir(MOCK_EXAM_JSON_DIR, { recursive: true });
await fs.mkdir(TCK_EXAM_JSON_DIR, { recursive: true });
await fs.mkdir(TEXTBOOK_EXERCISE_JSON_DIR, { recursive: true });
await fs.mkdir(TEXTBOOK_CONTENT_JSON_DIR, { recursive: true });
await prepareOutputDirectories(args);

const pdfInventory = await scanPdfInventory(ROOT);
const referenceAnswerIndex = await buildReferenceAnswerIndex();
const generatedQuestionBundles = [];
const generatedContentBundles = [];
const report = {
  generatedAt: new Date().toISOString(),
  examCount: pdfInventory.exams.length,
  textbookCount: pdfInventory.textbooks.length,
  questionBundles: [],
  contentBundles: [],
  bundles: [],
  failures: []
};

const examTargets = applyFilters(pdfInventory.exams, args);
const textbookTargets = applyFilters(pdfInventory.textbooks, args);

if (args.mode !== "textbooks") {
  for (const exam of examTargets) {
    try {
      const bundle = await convertExam(exam);
      if (bundle?.configEntries?.length) {
        generatedQuestionBundles.push(...bundle.configEntries);
        report.questionBundles.push(...bundle.reportEntries);
        report.bundles.push(...bundle.reportEntries);
      }
    } catch (error) {
      report.failures.push({
        kind: "exam",
        file: exam.primary.relPath,
        message: String(error?.stack || error)
      });
      console.error(`Failed exam conversion: ${exam.primary.relPath}`);
      console.error(error);
    }
  }
}

if (args.mode !== "exams") {
  for (const textbook of textbookTargets) {
    try {
      const bundle = await convertTextbook(textbook);
      if (bundle?.questionConfigEntry) {
        generatedQuestionBundles.push(bundle.questionConfigEntry);
        report.questionBundles.push(bundle.questionReportEntry);
        report.bundles.push(bundle.questionReportEntry);
      }
      if (bundle?.contentConfigEntry) {
        generatedContentBundles.push(bundle.contentConfigEntry);
        report.contentBundles.push(bundle.contentReportEntry);
        report.bundles.push(bundle.contentReportEntry);
      }
    } catch (error) {
      report.failures.push({
        kind: "textbook",
        file: textbook.relPath,
        message: String(error?.stack || error)
      });
      console.error(`Failed textbook conversion: ${textbook.relPath}`);
      console.error(error);
    }
  }
}

generatedQuestionBundles.sort((a, b) => a.file_name.localeCompare(b.file_name, "en"));
generatedContentBundles.sort((a, b) => a.file_name.localeCompare(b.file_name, "en"));
await updateConfig({
  questionBundles: generatedQuestionBundles,
  contentBundles: generatedContentBundles
});
await fs.writeFile(
  path.join(ROOT, "conversion_report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8"
);
await cleanupUnusedQuestionImages();

console.log(`Generated ${generatedQuestionBundles.length} question bundles.`);
console.log(`Generated ${generatedContentBundles.length} content bundles.`);
console.log(`Failures: ${report.failures.length}`);

async function readJsonFile(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content.replace(/^\uFEFF/, ""));
}

function parseArgs(argv) {
  const options = {
    mode: "all",
    limit: Number.POSITIVE_INFINITY,
    only: null,
    textbookTailPages: 8
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mode" && argv[index + 1]) {
      options.mode = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--limit" && argv[index + 1]) {
      options.limit = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--only" && argv[index + 1]) {
      options.only = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--textbook-tail-pages" && argv[index + 1]) {
      options.textbookTailPages = Number(argv[index + 1]);
      index += 1;
    }
  }

  return options;
}

function applyFilters(items, options) {
  let filtered = items;
  if (options.only) {
    filtered = filtered.filter((item) => JSON.stringify(item).includes(options.only));
  }
  if (Number.isFinite(options.limit)) {
    filtered = filtered.slice(0, options.limit);
  }
  return filtered;
}

async function scanPdfInventory(rootDir) {
  const entries = await walkPdfs(rootDir);
  const examMap = new Map();
  const analysisMap = new Map();
  const textbooks = [];

  for (const relPath of entries) {
    const classification = classifyPdf(relPath);
    const absPath = path.join(rootDir, relPath);
    const file = { absPath, relPath, name: path.basename(relPath), dir: path.dirname(relPath) };
    if (classification.kind === "exam") {
      file.examType = classification.examType;
      if (isAnalysisPdf(file.name)) {
        const key = `${classification.examType}::${makePairKey(relPath)}`;
        const list = analysisMap.get(key) || [];
        list.push(file);
        analysisMap.set(key, list);
      } else {
        const key = `${classification.examType}::${makePairKey(relPath)}`;
        const bucket = examMap.get(key) || [];
        bucket.push(file);
        examMap.set(key, bucket);
      }
    } else {
      textbooks.push(file);
    }
  }

  const exams = [];
  for (const [key, files] of examMap.entries()) {
    const sorted = files.sort((a, b) => compareSupplementOrder(a.name, b.name));
    exams.push({
      key,
      examType: sorted[0]?.examType || "mock",
      primary: sorted[0],
      questionFiles: sorted,
      analysisFiles: (analysisMap.get(key) || []).sort((a, b) => compareSupplementOrder(a.name, b.name))
    });
  }

  exams.sort((a, b) => a.primary.relPath.localeCompare(b.primary.relPath, "en"));
  textbooks.sort((a, b) => a.relPath.localeCompare(b.relPath, "en"));
  return { exams, textbooks };
}

function classifyPdf(relPath) {
  const parts = relPath.split(path.sep);
  if (parts[0] === "tck_past_exams" && isSchoolYearDir(parts[1] || "")) {
    return { kind: "exam", examType: "tck" };
  }
  if (parts[0] === "tck_mock_exams" && isSchoolYearDir(parts[1] || "")) {
    return { kind: "exam", examType: "mock" };
  }
  if (parts[0] === "統測歷屆試題" && /^\d{3}學年度$/u.test(parts[1] || "")) {
    return { kind: "exam", examType: "tck" };
  }
  if (parts[0] === "統測模擬考" && /^\d{3}學年度$/u.test(parts[1] || "")) {
    return { kind: "exam", examType: "mock" };
  }
  if (isSchoolYearDir(parts[0] || "")) {
    return { kind: "exam", examType: "mock" };
  }
  return { kind: "textbook" };
}

async function walkPdfs(dir, prefix = "") {
  const results = [];
  const items = await fs.readdir(dir, { withFileTypes: true });
  for (const item of items) {
    if (item.name === ".git" || item.name === "node_modules" || item.name === "assets" || item.name === ".codex-tmp") {
      continue;
    }
    const relPath = prefix ? path.join(prefix, item.name) : item.name;
    const absPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      results.push(...(await walkPdfs(absPath, relPath)));
    } else if (item.isFile() && /\.pdf$/i.test(item.name)) {
      results.push(relPath);
    }
  }
  return results;
}

function isAnalysisPdf(name) {
  return /解析|答案|詳解/i.test(name);
}

function makePairKey(relPath) {
  const stem = path.basename(relPath).replace(/\.pdf$/i, "").replace(/\.pdf$/i, "");
  return normalizeKey(`${path.dirname(relPath)}::${stem}`);
}

function normalizeKey(input) {
  return input
    .normalize("NFKC")
    .replace(/^\d+\.\s*/u, "")
    .replace(/\(\s*0*1\s*\)/gu, "")
    .replace(/P\d+$/iu, "")
    .replace(/解析|答案|詳解/gu, "試題")
    .replace(/數學_C_卷/gu, "數學(C)卷")
    .replace(/數學\(C\)試題/gu, "數學(C)卷試題")
    .replace(/\s+/gu, "")
    .replace(/\.pdf$/iu, "");
}

function compareSupplementOrder(a, b) {
  const aMatch = a.match(/P(\d+)\.pdf$/i);
  const bMatch = b.match(/P(\d+)\.pdf$/i);
  const aRank = aMatch ? Number(aMatch[1]) : -1;
  const bRank = bMatch ? Number(bMatch[1]) : -1;
  return aRank - bRank || a.localeCompare(b, "en");
}

async function convertExam(exam) {
  const metadata = buildExamMetadata(exam);
  const answerData = await extractExamAnswers(exam.analysisFiles, Number.POSITIVE_INFINITY);
  const extraction = await extractExamQuestions(exam.questionFiles, {
    subjectCode: metadata.subjectCode,
    separateChineseWriting: shouldSeparateChineseWriting(metadata),
    expectedQuestionCount: resolveExamExpectedQuestionCount(metadata, answerData.maxQuestionNumber)
  });
  if (extraction.questions.length === 0) {
    return null;
  }
  const configEntries = [];
  const reportEntries = [];
  const rebuiltQuestions = await buildExamQuestionRecords({
    metadata,
    exam,
    answerData,
    questions: extraction.questions
  });
  await writeExamBundle({
    metadata,
    sourceRelPath: exam.primary.relPath,
    questions: rebuiltQuestions,
    configEntries,
    reportEntries
  });

  if (extraction.writingQuestion && shouldSeparateChineseWriting(metadata)) {
    const writingMetadata = buildChineseWritingMetadata(metadata);
    const writingQuestions = await buildExamQuestionRecords({
      metadata: writingMetadata,
      exam,
      answerData,
      questions: [extraction.writingQuestion]
    });
    await writeExamBundle({
      metadata: writingMetadata,
      sourceRelPath: exam.primary.relPath,
      questions: writingQuestions,
      configEntries,
      reportEntries
    });
  }

  return { configEntries, reportEntries };
  const finalQuestions = [];

  for (const [index, question] of extraction.questions.entries()) {
    const answerLetter = question.kind === "writing" ? "A" : (answerData.answers.get(question.number) || "A");
    const answerIndex = letterToIndex(answerLetter);
    const cleanedExplanation =
      question.kind === "writing"
        ? ""
        : sanitizeExplanationBlock(answerData.explanations.get(question.number) || "", question.number);
    const explanation =
      question.kind === "writing"
        ? "非選擇題：作文／寫作測驗。"
        : cleanedExplanation ||
      `正解：(${answerLetter})` +
        (answerData.answerSources.has(question.number) ? `；來源：${answerData.answerSources.get(question.number)}` : "");

    const imageUrl =
      question.kind === "writing"
        ? ""
        : question.renderedImagePath
          ? await cropFromRenderedImage({
              bundleStem: metadata.fileStem,
              sourceImagePath: question.renderedImagePath,
              pageNumber: question.primaryPage,
              top: question.cropTop ?? 0,
              bottom: question.cropBottom ?? 0
            })
        : await maybeCropQuestionImage({
            bundleStem: metadata.fileStem,
            sourcePath: question.renderSource?.absPath || exam.primary.absPath,
            pageNumber: question.primaryPage,
            searchTop: question.searchTop,
            searchBottom: question.searchBottom,
            lineBoxes: question.lineBoxes,
            shouldCrop: question.shouldCropImage
          });

    finalQuestions.push({
      id: `${metadata.bundleId}_${String(index + 1).padStart(3, "0")}`,
      subject: metadata.subject,
      unit: metadata.unit,
      q: question.prompt,
      image_url: imageUrl,
      options: normalizeOptions(question.options),
      a: answerIndex,
      reward: 15,
      explanation
    });
  }

  const bundle = { bundle_id: metadata.bundleId, questions: finalQuestions };
  const outputPath = path.join(ROOT, metadata.fileName);
  await fs.writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

  return {
    configEntry: {
      id: metadata.bundleId,
      name: metadata.name,
      file_name: metadata.fileName,
      url: `${RAW_BASE}/${metadata.fileName}`,
      updated_at: currentDateString()
    },
    reportEntry: {
      kind: "exam",
      file: exam.primary.relPath,
      bundleId: metadata.bundleId,
      fileName: metadata.fileName,
      questions: finalQuestions.length,
      images: finalQuestions.filter((item) => item.image_url).length
    }
  };
}

async function buildExamQuestionRecords({ metadata, exam, answerData, questions }) {
  const records = [];

  for (const [index, question] of questions.entries()) {
    const answerLetter = question.kind === "writing" ? "A" : (answerData.answers.get(question.number) || "A");
    const answerIndex = letterToIndex(answerLetter);
    const cleanedExplanation =
      question.kind === "writing"
        ? ""
        : sanitizeExplanationBlock(answerData.explanations.get(question.number) || "", question.number);
    const explanation =
      question.kind === "writing"
        ? "Writing prompt"
        : cleanedExplanation ||
          `甇?圾嚗?${answerLetter})` +
            (answerData.answerSources.has(question.number) ? `嚗?皞?${answerData.answerSources.get(question.number)}` : "");

    const imageUrl =
      question.kind === "writing"
        ? ""
        : question.renderedImagePath
          ? await cropFromRenderedImage({
              bundleStem: metadata.fileStem,
              sourceImagePath: question.renderedImagePath,
              pageNumber: question.primaryPage,
              top: question.cropTop ?? 0,
              bottom: question.cropBottom ?? 0
            })
          : await maybeCropQuestionImage({
              bundleStem: metadata.fileStem,
              sourcePath: question.renderSource?.absPath || exam.primary.absPath,
              pageNumber: question.primaryPage,
              searchTop: question.searchTop,
              searchBottom: question.searchBottom,
              lineBoxes: question.lineBoxes,
              shouldCrop: question.shouldCropImage
            });

    records.push({
      id: `${metadata.bundleId}_${String(index + 1).padStart(3, "0")}`,
      subject: metadata.subject,
      unit: metadata.unit,
      q: question.prompt,
      image_url: imageUrl,
      options: normalizeOptions(question.options),
      a: answerIndex,
      reward: 15,
      explanation
    });
  }

  return records;
}

async function writeExamBundle({ metadata, sourceRelPath, questions, configEntries, reportEntries }) {
  const bundle = { bundle_id: metadata.bundleId, questions };
  const outputPath = path.join(ROOT, metadata.fileName);
  await fs.writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

  configEntries.push({
    id: metadata.bundleId,
    name: metadata.name,
    file_name: metadata.fileName,
    url: `${RAW_BASE}/${metadata.fileName}`,
    updated_at: currentDateString()
  });
  reportEntries.push({
    kind: "exam",
    file: sourceRelPath,
    bundleId: metadata.bundleId,
    fileName: metadata.fileName,
    questions: questions.length,
    images: questions.filter((item) => item.image_url).length
  });
}

function shouldSeparateChineseWriting(metadata) {
  return metadata.examType === "tck" && metadata.subjectCode === "CHI" && Number(metadata.year) >= 110;
}

function buildChineseWritingMetadata(metadata) {
  return {
    ...metadata,
    bundleId: `${metadata.bundleId}_WRITING`,
    fileStem: `${metadata.fileStem}_writing`,
    fileName: metadata.fileName.replace(/\.json$/iu, "_writing.json"),
    name: `${metadata.name}-writing`,
    unit: `${metadata.unit} writing`
  };
}

function buildExamMetadata(exam) {
  const relPath = exam.primary.relPath;
  const name = path.basename(relPath, ".pdf");
  const parts = relPath.split(path.sep);
  const yearDir = isSchoolYearDir(parts[0] || "") ? parts[0] : parts[1];
  const year = extractSchoolYear(yearDir);
  const sessionRaw =
    name.match(/統測-(\d{2})/u)?.[1] ||
    name.match(new RegExp(`${year}-(\\d+)`, "u"))?.[1] ||
    name.match(/-(\d+)-四技/u)?.[1] ||
    "0";
  const session = String(Number(sessionRaw));
  const subject = detectSubject(name);
  const subjectCode = detectSubjectCode(name);
  const cleanedName = name.replace(/試題$/u, "");
  const examType = exam.examType === "tck" ? "tck" : "mock";
  const bundlePrefix = examType === "tck" ? "TCK" : "MOCK";
  const outputDirName = examType === "tck" ? "tck_past_exams" : "mock_exams";
  return {
    bundleId: `${bundlePrefix}_${year}_${session}_${subjectCode}`,
    fileStem: `exam_${year}_${session}_${subjectCode.toLowerCase()}`,
    fileName: path.join("question_jsons", outputDirName, `exam_${year}_${session}_${subjectCode.toLowerCase()}.json`),
    name: cleanedName,
    subject,
    subjectCode,
    year,
    examType,
    unit: cleanedName
  };
}

function resolveExamExpectedQuestionCount(metadata, fallbackCount = 0) {
  if (metadata.examType === "tck" && Number(metadata.year) >= 110) {
    if (metadata.subjectCode === "CHI") return 38;
    if (metadata.subjectCode === "ENG") return Number(metadata.year) === 110 ? 41 : 42;
    if (metadata.subjectCode === "MATC") return 25;
  }
  return fallbackCount;
}

async function extractExamQuestions(questionFiles, options = {}) {
  const questions = [];
  const seen = new Set();
  const pageLineEntries = [];
  let writingQuestion = null;

  for (const file of questionFiles) {
    const pdf = await openPdf(file.absPath);
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const lines = await extractPdfLines(page);
      if (lines.length === 0) {
        continue;
      }
      const hasImage = await pageContainsImage(page);
      pageLineEntries.push({
        file,
        pageNumber,
        lines
      });
      const pageQuestions = parseQuestionsFromLines(lines, {
        defaultSource: file,
        pageNumber,
        pageHasImage: hasImage
      });
      const pageTextQuestions = parseInlinePdfQuestionsFromText(
        normalizeExtractedText(lines.map((line) => line.text).join(" ")),
        {
          defaultSource: file,
          pageNumber,
          pageHasImage: hasImage
        }
      );

      for (const parsed of [...pageQuestions, ...pageTextQuestions]) {
        if (!parsed.prompt || parsed.options.length < 4 || seen.has(parsed.number)) {
          continue;
        }
        seen.add(parsed.number);
        questions.push(parsed);
      }
    }
  }

  for (let index = 0; index < pageLineEntries.length - 1; index += 1) {
    const current = pageLineEntries[index];
    const next = pageLineEntries[index + 1];
    if (!samePath(current.file.absPath, next.file.absPath)) {
      continue;
    }
    const combinedText = normalizeExtractedText(
      `${current.lines.map((line) => line.text).join(" ")} ${next.lines.map((line) => line.text).join(" ")}`
    );
    const pairQuestions = parseInlinePdfQuestionsFromText(combinedText, {
      defaultSource: current.file,
      pageNumber: current.pageNumber,
      pageHasImage: false
    });
    for (const parsed of pairQuestions) {
      if (!parsed.prompt || parsed.options.length < 4 || seen.has(parsed.number)) {
        continue;
      }
      seen.add(parsed.number);
      questions.push(parsed);
    }
  }

  if (options.subjectCode === "CHI") {
    const compositionQuestion = extractChineseCompositionQuestion(pageLineEntries, questions.at(-1)?.number ?? 0);
    if (compositionQuestion && !seen.has(compositionQuestion.number)) {
      if (options.separateChineseWriting) {
        writingQuestion = compositionQuestion;
      } else {
        seen.add(compositionQuestion.number);
        questions.push(compositionQuestion);
      }
    }
  }

  if (shouldUseExamOcrFallback(questions, options.expectedQuestionCount)) {
    const ocrQuestions = await extractExamQuestionsWithOcr(questionFiles);
    for (const parsed of ocrQuestions) {
      if (!parsed.prompt || parsed.options.length < 4 || seen.has(parsed.number)) {
        continue;
      }
      if (options.expectedQuestionCount && parsed.number > options.expectedQuestionCount) {
        continue;
      }
      seen.add(parsed.number);
      questions.push(parsed);
    }
  }

  questions.sort((a, b) => a.number - b.number);
  return { questions, writingQuestion };
}

async function extractExamAnswers(analysisFiles, expectedCount) {
  const answers = new Map();
  const answerSources = new Map();
  const explanations = new Map();

  for (const file of analysisFiles) {
    const pdf = await openPdf(file.absPath);
    const pageLines = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const lines = await extractPdfLines(page);
      pageLines.push(lines);
    }

    const flatLines = pageLines.flat();
    for (const [questionNumber, answerLetter] of parseAnswerPairsFromLines(flatLines)) {
      if (!answers.has(questionNumber)) {
        answers.set(questionNumber, answerLetter);
        answerSources.set(questionNumber, path.basename(file.relPath || file.absPath));
      }
    }
    for (const [questionNumber, answerLetter] of parseAnswerTableFromLines(flatLines)) {
      if (!answers.has(questionNumber)) {
        answers.set(questionNumber, answerLetter);
        answerSources.set(questionNumber, path.basename(file.relPath || file.absPath));
      }
    }
    for (const [questionNumber, block] of parseNumberedBlocks(flatLines)) {
      if (!explanations.has(questionNumber)) {
        explanations.set(questionNumber, block);
      }
    }

    if (answers.size >= expectedCount) {
      break;
    }
  }

  const maxQuestionNumber = Math.max(
    0,
    ...answers.keys(),
    ...explanations.keys()
  );

  return { answers, answerSources, explanations, maxQuestionNumber };
}

function parseAnswerPairsFromLines(lines) {
  const answers = new Map();
  for (const line of lines) {
    const text = normalizeExtractedText(line.text);
    for (const match of text.matchAll(/(?:^|\s)(\d{1,3})\s*[\.:、]?\s*([ABCD])(?=\s|$)/gu)) {
      answers.set(Number(match[1]), match[2]);
    }
  }
  return answers;
}

function parseAnswerTableFromLines(lines) {
  const answers = new Map();
  for (let index = 0; index < lines.length - 1; index += 1) {
    const current = normalizeExtractedText(lines[index].text);
    const next = normalizeExtractedText(lines[index + 1].text);
    const numbers = [...current.matchAll(/(?:^|\s)(\d{1,3})(?=\s|$)/gu)].map((match) => Number(match[1]));
    const letters = [...next.matchAll(/(?:^|\s)([ABCD])(?=\s|$)/gu)].map((match) => match[1]);
    if (numbers.length >= 3 && letters.length >= 3 && Math.abs(numbers.length - letters.length) <= 2) {
      const pairCount = Math.min(numbers.length, letters.length);
      for (let offset = 0; offset < pairCount; offset += 1) {
        answers.set(numbers[offset], letters[offset]);
      }
    }
  }
  return answers;
}

function parseNumberedBlocks(lines) {
  const blocks = new Map();
  let currentNumber = null;
  let currentText = [];

  for (const line of lines) {
    const text = normalizeExtractedText(line.text);
    const start = text.match(/^(\d{1,3})[\.、]\s*(.+)?$/u);
    if (start) {
      if (currentNumber !== null && currentText.length > 0) {
        blocks.set(currentNumber, currentText.join(" ").trim());
      }
      currentNumber = Number(start[1]);
      currentText = [start[2] || ""];
      continue;
    }
    if (currentNumber !== null && text) {
      currentText.push(text);
    }
  }

  if (currentNumber !== null && currentText.length > 0) {
    blocks.set(currentNumber, currentText.join(" ").trim());
  }
  return blocks;
}

async function convertTextbook(file) {
  const metadata = buildTextbookMetadata(file.relPath);
  const contentMetadata = buildTextbookContentMetadata(file.relPath, metadata);
  const pdf = await openPdf(file.absPath);
  const pageStart = Math.max(1, pdf.numPages - args.textbookTailPages + 1);
  const renderedPages = [];

  for (let pageNumber = pageStart; pageNumber <= pdf.numPages; pageNumber += 1) {
    const imagePath = await renderPageImage(pdf, file.absPath, pageNumber, 3.5);
    renderedPages.push({ pageNumber, imagePath });
  }

  const ocrResults = await runOcr(renderedPages.map((item) => item.imagePath));
  const ocrPages = renderedPages.map((item) => {
    const result = ocrResults.find((entry) => samePath(entry.path, item.imagePath));
    return {
      pageNumber: item.pageNumber,
      imagePath: item.imagePath,
      width: result?.width || 0,
      height: result?.height || 0,
      text: normalizeOcrText(result?.text || ""),
      lines: (result?.lines || [])
        .map((line) => ({
          text: normalizeOcrText(line.text),
          top: line.y,
          bottom: line.y + line.height,
          left: line.x,
          pageNumber: item.pageNumber
        }))
        .filter((line) => line.text)
    };
  });

  const questionPages = ocrPages.filter((page) => countOptionMarkers(page.text) >= 4);
  const answerPages = ocrPages.filter((page) => !questionPages.includes(page) && countQuestionMarkers(page.text) >= 2);
  const parsedQuestions = parseQuestionsFromOcrPages(questionPages, file);
  let questionConfigEntry = null;
  let questionReportEntry = null;

  if (parsedQuestions.length > 0) {
    const answerData = parseTextbookAnswers(answerPages);
    const isWorkbook = /鍛鍊本/u.test(file.relPath);
    const finalQuestions = [];

    for (const [index, question] of parsedQuestions.entries()) {
      const explicitAnswerLetter = answerData.answers.get(question.number) || null;
      const explicitExplanation = answerData.explanations.get(question.number) || "";
      const referenceAnswer =
        !explicitAnswerLetter && isWorkbook ? resolveAnswerFromReferenceIndex(question) : null;
      const useReferenceQuestion = isWorkbook && shouldUseReferenceQuestion(question, referenceAnswer);
      const finalPrompt = useReferenceQuestion ? referenceAnswer.prompt : question.prompt;
      const finalOptions = useReferenceQuestion ? referenceAnswer.options : normalizeOptions(question.options);
      const answerIndex =
        explicitAnswerLetter !== null
          ? letterToIndex(explicitAnswerLetter)
          : referenceAnswer?.a ?? 0;
      const explanation =
        explicitExplanation && !(isWorkbook && shouldUseReferenceExplanation(explicitExplanation, referenceAnswer))
          ? explicitExplanation
          : referenceAnswer?.explanation || `自動整理答案：(${indexToLetter(answerIndex)})`;
      const imageUrl = question.shouldCropImage
        ? await cropFromRenderedImage({
            bundleStem: metadata.fileStem,
            sourceImagePath: question.renderedImagePath,
            pageNumber: question.primaryPage,
            top: question.cropTop,
            bottom: question.cropBottom
          })
        : "";

      finalQuestions.push({
        id: `${metadata.bundleId}_${String(index + 1).padStart(3, "0")}`,
        subject: metadata.subject,
        unit: question.unit || metadata.unit,
        q: finalPrompt,
        image_url: imageUrl,
        options: finalOptions,
        a: answerIndex,
        reward: 15,
        explanation
      });
    }

    const bundle = { bundle_id: metadata.bundleId, questions: finalQuestions };
    await fs.writeFile(path.join(ROOT, metadata.fileName), `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

    questionConfigEntry = {
      id: metadata.bundleId,
      name: metadata.name,
      file_name: metadata.fileName,
      url: `${RAW_BASE}/${metadata.fileName}`,
      updated_at: currentDateString()
    };
    questionReportEntry = {
      kind: "textbook_questions",
      file: file.relPath,
      bundleId: metadata.bundleId,
      fileName: metadata.fileName,
      questions: finalQuestions.length,
      images: finalQuestions.filter((item) => item.image_url).length
    };

    if (!isWorkbook) {
      indexReferenceQuestions(finalQuestions);
    }
  }

  let contentConfigEntry = null;
  let contentReportEntry = null;
  if (shouldGenerateTextbookContent(file)) {
    const contentEndPage = parsedQuestions.length > 0 ? pageStart - 1 : pdf.numPages;
    const contentPages = await extractTextbookContentPages({
      pdf,
      sourcePath: file.absPath,
      sourceRelPath: file.relPath,
      metadata: contentMetadata,
      endPage: contentEndPage
    });

    if (contentPages.length > 0) {
      const contentBundle = {
        content_id: contentMetadata.contentId,
        subject: contentMetadata.subject,
        chapter: contentMetadata.chapter,
        title: contentMetadata.title,
        source_pdf: file.relPath.replaceAll(path.sep, "/"),
        question_bundle_id: questionConfigEntry?.id || null,
        pages: contentPages
      };
      await fs.writeFile(path.join(ROOT, contentMetadata.fileName), `${JSON.stringify(contentBundle, null, 2)}\n`, "utf8");

      contentConfigEntry = {
        id: contentMetadata.contentId,
        name: contentMetadata.name,
        file_name: contentMetadata.fileName,
        url: `${RAW_BASE}/${contentMetadata.fileName}`,
        updated_at: currentDateString(),
        subject: contentMetadata.subject,
        chapter: contentMetadata.chapter.code,
        question_bundle_id: questionConfigEntry?.id || null
      };
      contentReportEntry = {
        kind: "textbook_content",
        file: file.relPath,
        bundleId: contentMetadata.contentId,
        fileName: contentMetadata.fileName,
        pages: contentPages.length,
        images: contentPages.filter((item) => item.page_image_url).length
      };
    }
  }

  if (!questionConfigEntry && !contentConfigEntry) {
    return null;
  }

  return {
    questionConfigEntry,
    questionReportEntry,
    contentConfigEntry,
    contentReportEntry
  };
}

function buildTextbookMetadata(relPath) {
  const [topLevel] = relPath.split(path.sep);
  const chapterName = path.basename(relPath, ".pdf");
  const bookCode = BOOK_CODE_MAP.get(topLevel) || fallbackSlug(topLevel);
  const chapterCode = detectChapterCode(chapterName);
  const cleanBook = BOOK_DISPLAY_MAP.get(topLevel) || topLevel.replace(/_ppt$/iu, "");
  const cleanChapter = chapterName.replace(/PDF$/iu, "");
  return {
    bundleId: `TEXT_${bookCode.toUpperCase()}_${chapterCode.toUpperCase()}`,
    fileStem: `text_${bookCode}_${chapterCode}`,
    fileName: path.join("question_jsons", "textbook_exercises", `text_${bookCode}_${chapterCode}.json`),
    name: `${cleanBook} ${cleanChapter}`.trim(),
    subject: cleanBook,
    unit: cleanChapter
  };
}

function buildTextbookContentMetadata(relPath, questionMetadata) {
  const [topLevel] = relPath.split(path.sep);
  const chapterName = path.basename(relPath, ".pdf");
  const cleanBook = BOOK_DISPLAY_MAP.get(topLevel) || topLevel.replace(/_ppt$/iu, "");
  const cleanChapter = chapterName.replace(/PDF$/iu, "");
  const contentId = `CONTENT_${questionMetadata.fileStem.replace(/^text_/u, "").toUpperCase()}`;
  const fileStem = `content_${questionMetadata.fileStem.replace(/^text_/u, "")}`;
  return {
    contentId,
    fileStem,
    fileName: path.join("content_jsons", "textbooks", `${fileStem}.json`),
    name: `${cleanBook} ${cleanChapter}`.trim(),
    subject: cleanBook,
    chapter: {
      code: detectChapterCode(chapterName).toUpperCase(),
      title: cleanChapter
    },
    title: `${cleanBook} ${cleanChapter}`.trim()
  };
}

function shouldGenerateTextbookContent(file) {
  return !/鍛鍊本/u.test(file.relPath);
}

function detectChapterCode(chapterName) {
  const chMatch = chapterName.match(/^CH(\d+)/iu);
  if (chMatch) return `ch${String(chMatch[1]).padStart(2, "0")}`;
  const numberMatch = chapterName.match(/^(\d{2})_/u);
  if (numberMatch) return `ch${numberMatch[1]}`;
  const workbookMatch = chapterName.match(/-(\d{2})$/u);
  if (workbookMatch) return `wk${workbookMatch[1]}`;
  if (/附錄/u.test(chapterName)) return "appendix";
  return fallbackSlug(chapterName).slice(0, 12);
}

function isSchoolYearDir(value) {
  return /^year_\d{3}$/iu.test(value) || /^\d{3}學年度$/u.test(value);
}

function extractSchoolYear(value) {
  return value?.match(/^year_(\d{3})$/iu)?.[1] || value?.match(/^(\d{3})學年度$/u)?.[1] || "000";
}

async function extractTextbookContentPages({ pdf, sourcePath, sourceRelPath, metadata, endPage }) {
  if (endPage < 1) return [];
  const pages = [];

  for (let pageNumber = 1; pageNumber <= endPage; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    let lines = await extractPdfLines(page);
    let usedOcr = false;
    let renderedImagePath = null;

    if (contentLinesNeedOcr(lines)) {
      renderedImagePath = await renderPageImage(pdf, sourcePath, pageNumber, 2.4);
      const [ocrPage] = await runOcr([renderedImagePath]);
      lines = (ocrPage?.lines || [])
        .map((line) => ({
          text: normalizeOcrText(line.text),
          top: line.y,
          bottom: line.y + line.height,
          left: line.x,
          right: line.x + line.width,
          pageNumber
        }))
        .filter((line) => line.text && !isHeaderFooter(line.text));
      usedOcr = true;
    }

    const blocks = buildContentBlocks(lines);
    if (blocks.length === 0) {
      continue;
    }

    const pageText = blocks.map((block) => block.text).join("\n");
    const hasRenderableImage = await pageContainsImage(page);
    let pageImageUrl = "";
    if (shouldCreateContentPageImage({
      sourceRelPath,
      pageText,
      hasRenderableImage,
      usedOcr
    })) {
      renderedImagePath ||= await renderPageImage(pdf, sourcePath, pageNumber, 2.4);
      pageImageUrl = await renderContentPageImage({
        bundleStem: metadata.fileStem,
        sourceImagePath: renderedImagePath,
        pageNumber
      });
    }

    pages.push({
      page: pageNumber,
      blocks,
      page_image_url: pageImageUrl
    });
  }

  if (pages.length > 0) {
    const titleText = extractContentTitle(pages) || metadata.chapter.title;
    if (titleText) {
      metadata.title = `${metadata.subject} ${titleText}`.trim();
      metadata.name = metadata.title;
    }
  }

  return pages;
}

function extractContentTitle(pages) {
  const firstPage = pages[0];
  if (!firstPage) return "";
  const titleParts = [];
  for (const block of firstPage.blocks) {
    if (block.type !== "heading") continue;
    if (/本章綱要|學習目標|知識|立即評量/u.test(block.text)) break;
    titleParts.push(block.text);
    if (titleParts.length >= 3) break;
  }
  return normalizeContentBlockText(titleParts.join(" "));
}

function contentLinesNeedOcr(lines) {
  const textLength = lines.reduce((sum, line) => sum + line.text.length, 0);
  return lines.length < 3 || textLength < 40;
}

function buildContentBlocks(lines) {
  if (lines.length === 0) return [];
  const sorted = [...lines].sort((a, b) => (a.top - b.top) || (a.left - b.left));
  const blocks = [];
  let paragraph = [];
  let previous = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = normalizeContentBlockText(paragraph.map((line) => line.text).join(" "));
    if (text) {
      blocks.push({ type: "paragraph", text });
    }
    paragraph = [];
  };

  for (const line of sorted) {
    if (isContentHeading(line.text)) {
      flushParagraph();
      blocks.push({ type: "heading", text: normalizeContentBlockText(line.text) });
      previous = line;
      continue;
    }

    const gap = previous ? line.top - previous.bottom : 0;
    if (gap > 28) {
      flushParagraph();
    }
    paragraph.push(line);
    previous = line;
  }

  flushParagraph();
  return blocks.filter((block) => block.text);
}

function normalizeContentBlockText(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s*([，。；：！？、])/g, "$1")
    .trim();
}

function isContentHeading(text) {
  if (!text) return false;
  if (/^第[一二三四五六七八九十百零\d]+章/u.test(text)) return true;
  if (/^第[一二三四五六七八九十百零\d]+節/u.test(text)) return true;
  if (/^[一二三四五六七八九十]+[、.．]/u.test(text)) return true;
  if (/^\d+[、.．]/u.test(text)) return true;
  return text.length <= 24 && !/[，。；：！？]/u.test(text);
}

function shouldCreateContentPageImage({ sourceRelPath, pageText, hasRenderableImage, usedOcr }) {
  if (/_PPT[\\/]/u.test(sourceRelPath)) return true;
  if (hasExplicitFigureCue(pageText)) return true;
  if (hasRenderableImage && usedOcr) return true;
  return false;
}

async function renderContentPageImage({ bundleStem, sourceImagePath, pageNumber }) {
  const outputDir = path.join(OUTPUT_CONTENT_IMAGE_DIR, bundleStem);
  await fs.mkdir(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, `p${String(pageNumber).padStart(3, "0")}.jpg`);
  await sharp(sourceImagePath)
    .jpeg({ quality: 78, mozjpeg: true })
    .toFile(outputFile);
  return `${RAW_BASE}/${path.relative(ROOT, outputFile).replaceAll(path.sep, "/")}`;
}

function detectSubject(input) {
  if (/機械群專一/u.test(input)) return "機械群專一";
  if (/機械群專二/u.test(input)) return "機械群專二";
  if (/數學/u.test(input)) return "數學(C)";
  if (/國文/u.test(input)) return "國文";
  if (/英文/u.test(input)) return "英文";
  if (/外語群英文類專二/u.test(input)) return "外語群英文類專二";
  return input.replace(/試題|解析|答案|詳解/u, "");
}

function detectSubjectCode(input) {
  for (const [token, code] of SUBJECT_CODE_MAP) {
    if (input.includes(token)) return code;
  }
  return fallbackSlug(input).slice(0, 8).toUpperCase();
}

function fallbackSlug(input) {
  const ascii = input
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]+/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  if (ascii) return ascii;
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 12);
}

async function openPdf(absPath) {
  const data = new Uint8Array(await fs.readFile(absPath));
  return getDocument({
    data,
    cMapUrl: PDFJS_CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: PDFJS_STANDARD_FONT_URL,
    wasmUrl: PDFJS_WASM_URL
  }).promise;
}

async function extractPdfLines(page) {
  const viewport = page.getViewport({ scale: 1 });
  const text = await page.getTextContent();
  const items = text.items
    .map((item) => ({
      text: normalizeExtractedText(item.str),
      left: item.transform[4],
      top: viewport.height - item.transform[5],
      width: item.width || 0,
      height: Math.abs(item.height || item.transform[3] || 12)
    }))
    .filter((item) => item.text);

  const rows = [];
  for (const item of items) {
    let row = rows.find((candidate) => Math.abs(candidate.top - item.top) < 4);
    if (!row) {
      row = { top: item.top, bottom: item.top + item.height, items: [] };
      rows.push(row);
    }
    row.items.push(item);
    row.bottom = Math.max(row.bottom, item.top + item.height);
  }

  rows.sort((a, b) => a.top - b.top);
  return rows
    .map((row) => {
      row.items.sort((a, b) => a.left - b.left);
      return {
        text: normalizeExtractedText(row.items.map((item) => item.text).join(" ")),
        top: row.top,
        bottom: row.bottom,
        left: Math.min(...row.items.map((item) => item.left)),
        right: Math.max(...row.items.map((item) => item.left + item.width)),
        pageNumber: page.pageNumber
      };
    })
    .filter((row) => row.text && !isHeaderFooter(row.text));
}

function isHeaderFooter(text) {
  return /共\s*\d+\s*頁|第\s*\d+\s*頁/u.test(text);
}

async function pageContainsImage(page) {
  const operatorList = await page.getOperatorList();
  return operatorList.fnArray.some((fn) =>
    fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintJpegXObject
  );
}

function parseQuestionsFromLines(lines, context) {
  const rawQuestions = [];
  let current = null;

  for (const line of lines) {
    const questionNumber = extractQuestionNumber(line.text);
    if (questionNumber !== null) {
      if (current) finalizeQuestion(current, rawQuestions);
      current = {
        number: questionNumber,
        lines: [line],
        pageHasImage: context.pageHasImage,
        renderSource: context.defaultSource,
        primaryPage: context.pageNumber
      };
    } else if (current) {
      current.lines.push(line);
    }
  }

  if (current) finalizeQuestion(current, rawQuestions);

  for (let index = 0; index < rawQuestions.length; index += 1) {
    const question = rawQuestions[index];
    const next = rawQuestions[index + 1];
    question.searchTop = Math.max(0, Math.floor(question.lineBoxes[0].top - 24));
    question.searchBottom = next
      ? Math.max(question.searchTop + 40, Math.ceil(next.lineBoxes[0].top - 12))
      : Math.ceil(question.lineBoxes.at(-1).bottom + 260);
  }

  return rawQuestions;
}

function selectExamChoiceLines(lines, state) {
  if (state.reachedEnd) return [];

  const selected = [];
  for (const line of lines) {
    const text = normalizeExtractedText(line.text);
    if (!state.inChoiceSection) {
      if (!isExamChoiceSectionStart(text)) {
        continue;
      }
      state.inChoiceSection = true;
    }
    if (isExamQuestionSectionEnd(text)) {
      state.reachedEnd = true;
      break;
    }
    selected.push(line);
  }

  return selected;
}

function isExamChoiceSectionStart(text) {
  return /(?:^|[\s(（])(?:一|1)[、.．]\s*選擇題|選擇題\s*\(/u.test(text);
}

function isExamQuestionSectionEnd(text) {
  return /(非選擇題|寫作測驗|作文測驗|以下空白)/u.test(text);
}

function finalizeQuestion(current, questions) {
  const mergedText = normalizeExtractedText(current.lines.map((line) => line.text).join(" "));
  const parsed = splitQuestionAndOptions(stripCompositionTail(mergedText));
  if (!parsed || parsed.options.length < 4) return;
  if (isLikelyInstructionPrompt(parsed.prompt)) return;
  const wantsImage = hasExplicitFigureCue(`${parsed.prompt} ${parsed.options.join(" ")}`);
  questions.push({
    number: current.number,
    prompt: parsed.prompt,
    options: parsed.options,
    renderSource: current.renderSource,
    primaryPage: current.primaryPage,
    lineBoxes: current.lines.map((line) => ({
      top: line.top,
      bottom: line.bottom,
      left: line.left,
      right: line.right
    })),
    shouldCropImage: wantsImage
  });
}

function isLikelyInstructionPrompt(prompt) {
  const normalized = normalizeExtractedText(prompt);
  return /(本試卷|本試題本|注意事項|答案卡|准考證|考試開始鈴|請核對|監試人員|不可以翻閱試題本)/u.test(normalized);
}

function parseInlinePdfQuestionsFromText(pageText, context) {
  const questions = [];
  const optionPattern = /(\d{1,3})\s*[.．]?\s*[\(（]\s*A\s*[\)）]\s*(.*?)\s*[\(（]\s*B\s*[\)）]\s*(.*?)\s*[\(（]\s*C\s*[\)）]\s*(.*?)\s*[\(（]\s*D\s*[\)）]\s*(.*?)(?=\s+\d{1,3}\s*[.．]?\s*[\(（]\s*A\s*[\)）]|$)/gsu;
  const matches = [...pageText.matchAll(optionPattern)];

  for (const match of matches) {
    const number = Number(match[1]);
    const options = [match[2], match[3], match[4], match[5]].map((value) => normalizeExtractedText(value));
    const prompt = extractInlinePassagePrompt(pageText.slice(0, match.index ?? 0), number);
    if (!prompt || isLikelyInstructionPrompt(prompt)) continue;
    questions.push({
      number,
      prompt,
      options,
      renderSource: context.defaultSource,
      primaryPage: context.pageNumber,
      lineBoxes: [],
      shouldCropImage: hasExplicitFigureCue(`${prompt} ${options.join(" ")}`)
    });
  }

  return questions;
}

function extractInlinePassagePrompt(passageText, number) {
  const numberPattern = String(number).split("").join("\\s*");
  const marker = new RegExp(`(^|\\s)${numberPattern}(?=\\s|[,.])`, "gu");
  const candidates = [...passageText.matchAll(marker)];
  const match = candidates
    .map((item) => {
      const markerIndex = item.index + item[1].length;
      const windowText = passageText.slice(Math.max(0, markerIndex - 24), Math.min(passageText.length, markerIndex + 24));
      const headingPenalty = /(第\s*\d|\d\s*至\s*\d|共有|空格|回答|短文共有)/u.test(windowText) ? 10 : 0;
      return { item, markerIndex, score: headingPenalty };
    })
    .sort((left, right) => left.score - right.score)[0];
  if (!match || match.score >= 10) return "";

  const markerIndex = match.markerIndex;
  const start = Math.max(
    0,
    Math.max(
      passageText.lastIndexOf("。", markerIndex),
      passageText.lastIndexOf(".", markerIndex),
      passageText.lastIndexOf("?", markerIndex),
      passageText.lastIndexOf("!", markerIndex),
      markerIndex - 120
    )
  );
  const endCandidates = [
    passageText.indexOf("。", markerIndex),
    passageText.indexOf(".", markerIndex),
    passageText.indexOf("?", markerIndex),
    passageText.indexOf("!", markerIndex)
  ].filter((value) => value >= 0);
  const end = endCandidates.length > 0 ? Math.min(...endCandidates) + 1 : Math.min(passageText.length, markerIndex + 120);
  return normalizeExtractedText(
    passageText
      .slice(start, end)
      .replace(new RegExp(numberPattern, "u"), " ____ ")
  );
}

function parseQuestionsFromOcrPages(pages, sourceFile) {
  const lines = [];
  for (const page of pages) {
    for (const line of page.lines) {
      lines.push({ ...line, renderedImagePath: page.imagePath, pageText: page.text });
    }
  }
  lines.sort((a, b) => a.pageNumber - b.pageNumber || a.top - b.top);

  const questions = [];
  let current = null;
  let currentUnit = null;

  for (const line of lines) {
    if (/^\d+-\d+$/u.test(line.text) || /^第?\d+章/u.test(line.text)) currentUnit = line.text;
    const questionNumber = extractQuestionNumber(line.text);
    if (questionNumber !== null) {
      if (current) finalizeOcrQuestion(current, questions);
      current = {
        number: questionNumber,
        lines: [line],
        unit: currentUnit,
        renderedImagePath: line.renderedImagePath,
        primaryPage: line.pageNumber,
        pageText: line.pageText,
        renderSource: sourceFile
      };
    } else if (current) {
      current.lines.push(line);
    }
  }

  if (current) finalizeOcrQuestion(current, questions);
  for (const page of pages) {
    questions.push(...parseInlineOcrQuestionsFromPage(page, sourceFile));
  }
  return questions;
}

function finalizeOcrQuestion(current, questions) {
  const mergedText = normalizeOcrText(current.lines.map((line) => line.text).join(" "));
  const chunks = splitMergedOcrQuestions(mergedText, current.number);
  const cropTop = Math.max(0, Math.floor(Math.min(...current.lines.map((line) => line.top)) - 50));
  const cropBottom = Math.ceil(Math.max(...current.lines.map((line) => line.bottom)) + 50);

  for (const chunk of chunks) {
    const parsed = splitQuestionAndOptions(chunk.text);
    if (!parsed || parsed.options.length < 4) continue;
    if (isLikelyInstructionPrompt(parsed.prompt)) continue;
    questions.push({
      number: chunk.number,
      prompt: parsed.prompt,
      options: parsed.options,
      unit: current.unit,
      renderedImagePath: current.renderedImagePath,
      primaryPage: current.primaryPage,
      cropTop,
      cropBottom,
      shouldCropImage: hasExplicitFigureCue(`${parsed.prompt} ${parsed.options.join(" ")}`)
    });
  }
}

function parseInlineOcrQuestionsFromPage(page, sourceFile) {
  const questions = [];
  const chunks = splitMergedOcrQuestions(page.text || "", 0);

  for (const chunk of chunks) {
    if (!chunk.number || !/\([A-D]\)/u.test(chunk.text)) continue;
    const parsed = splitQuestionAndOptions(`${chunk.number}. ${chunk.text}`);
    if (!parsed || parsed.options.length < 4) continue;
    if (isLikelyInstructionPrompt(parsed.prompt)) continue;
    questions.push({
      number: chunk.number,
      prompt: parsed.prompt,
      options: parsed.options,
      renderedImagePath: page.imagePath,
      primaryPage: page.pageNumber,
      renderSource: sourceFile,
      cropTop: 0,
      cropBottom: 0,
      shouldCropImage: hasExplicitFigureCue(`${parsed.prompt} ${parsed.options.join(" ")}`)
    });
  }

  return questions;
}

function shouldUseExamOcrFallback(questions, expectedQuestionCount) {
  if (!expectedQuestionCount) return false;
  if (questions.length < expectedQuestionCount) return true;
  const seen = new Set(questions.map((question) => question.number));
  for (let number = 1; number <= expectedQuestionCount; number += 1) {
    if (!seen.has(number)) return true;
  }
  return false;
}

async function extractExamQuestionsWithOcr(questionFiles) {
  const renderedPages = [];

  for (const file of questionFiles) {
    const pdf = await openPdf(file.absPath);
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const imagePath = await renderPageImage(pdf, file.absPath, pageNumber, 3.2);
      renderedPages.push({ file, pageNumber, imagePath });
    }
  }

  const ocrResults = await runOcr(renderedPages.map((item) => item.imagePath));
  const pagesByFile = new Map();

  for (const entry of renderedPages) {
    const result = ocrResults.find((item) => samePath(item.path, entry.imagePath));
    const page = {
      pageNumber: entry.pageNumber,
      imagePath: entry.imagePath,
      text: normalizeOcrText(result?.text || ""),
      lines: (result?.lines || [])
        .map((line) => ({
          text: normalizeOcrText(line.text),
          top: line.y,
          bottom: line.y + line.height,
          left: line.x,
          pageNumber: entry.pageNumber
        }))
        .filter((line) => line.text)
    };

    const bucket = pagesByFile.get(entry.file.absPath) || [];
    bucket.push(page);
    pagesByFile.set(entry.file.absPath, bucket);
  }

  const parsed = [];
  for (const file of questionFiles) {
    const pages = (pagesByFile.get(file.absPath) || [])
      .filter((page) => countOptionMarkers(page.text) >= 4)
      .sort((a, b) => a.pageNumber - b.pageNumber);
    parsed.push(...parseQuestionsFromOcrPages(pages, file));
  }
  return parsed;
}

function extractQuestionNumber(text) {
  const match = normalizeExtractedText(text).match(/^(?:\(\s*\)\s*)?(\d{1,3})\s*[\.、,·]/u);
  return match ? Number(match[1]) : null;
}

function splitQuestionAndOptions(input) {
  let text = input
    .replace(/[（]/gu, "(")
    .replace(/[）]/gu, ")")
    .replace(/\b([A-Da-d])[.、]/gu, (_, letter) => `(${letter.toUpperCase()})`)
    .replace(/\(\s*([A-Da-d])\s*[\.\)]/gu, (_, letter) => `(${letter.toUpperCase()})`)
    .replace(/\s+/gu, " ")
    .trim();

  text = text.replace(/^(?:\(\s*\)\s*)?\d{1,3}\s*[\.、,·]\s*/u, "");
  const positions = ["A", "B", "C", "D"].map((letter) => text.indexOf(`(${letter})`));
  if (positions.some((value) => value < 0)) return null;

  const prompt = text.slice(0, positions[0]).trim();
  const options = [];
  for (let index = 0; index < positions.length; index += 1) {
    const start = positions[index] + 3;
    const end = index + 1 < positions.length ? positions[index + 1] : text.length;
    options.push(text.slice(start, end).trim());
  }
  return { prompt, options };
}

function stripCompositionTail(text) {
  const cueIndex = findCompositionCueIndex(text);
  if (cueIndex < 0) return text;
  return text.slice(0, cueIndex).trim();
}

function findCompositionCueIndex(text) {
  const normalized = normalizeExtractedText(text);
  const match = normalized.match(/(?:^|\s)(?:二、\s*)?(?:寫作測驗|國寫)(?=\s|[:：]|【|[(（])/u);
  return match ? match.index + match[0].search(/(?:二、\s*)?(?:寫作測驗|國寫)/u) : -1;
}

function extractChineseCompositionQuestion(pageLineEntries, lastQuestionNumber) {
  if (!Array.isArray(pageLineEntries) || pageLineEntries.length === 0) return null;

  let targetEntry = null;
  for (const entry of pageLineEntries) {
    const pageText = normalizeExtractedText(entry.lines.map((line) => line.text).join(" "));
    if (findCompositionCueIndex(pageText) >= 0) {
      targetEntry = entry;
    }
  }

  if (!targetEntry) return null;

  const pageText = normalizeExtractedText(targetEntry.lines.map((line) => line.text).join(" "));
  const cueIndex = findCompositionCueIndex(pageText);
  if (cueIndex < 0) return null;

  let prompt = pageText.slice(cueIndex).trim();
  prompt = prompt.replace(/(?:【以下空白】|公告參考答案|參考答案|國文詳解|詳解).*$/u, "").trim();
  prompt = prompt.replace(/\s*-\s*\d+\s*-\s*$/u, "").trim();
  const restartMatch = [...prompt.matchAll(/(?:^|\s)(\d{1,2})\.\s/gu)].find((match) => match.index > 120 && match[1] === "1");
  if (restartMatch) {
    prompt = prompt.slice(0, restartMatch.index).trim();
  }
  prompt = prompt.replace(/\s+/gu, " ").trim();

  if (prompt.length < 12) return null;

  return {
    number: Number(lastQuestionNumber) + 1,
    prompt,
    options: ["自由作答", "申論寫作", "作文題", "詳見題目說明"],
    renderSource: targetEntry.file,
    primaryPage: targetEntry.pageNumber || 1,
    lineBoxes: [],
    shouldCropImage: false,
    kind: "writing"
  };
}

function splitMergedOcrQuestions(input, fallbackNumber) {
  const text = normalizeOcrText(input);
  const matches = [...text.matchAll(/(^|\s)(\d{1,3})\s*[\.、·]/gu)];
  if (matches.length === 0) {
    return [{ number: fallbackNumber, text }];
  }

  return matches.map((match, index) => {
    const start = match.index + match[1].length;
    const end = index + 1 < matches.length ? matches[index + 1].index + matches[index + 1][1].length : text.length;
    return {
      number: Number(match[2]),
      text: text.slice(start, end).trim()
    };
  });
}

function hasExplicitFigureCue(text) {
  const normalized = normalizeExtractedText(text);
  return /(如圖(?:所示)?|下圖|附圖|見圖|圖\s*[(（]?[一二三四五六七八九十\d]+)/u.test(normalized);
}

function normalizeExtractedText(text) {
  return text.normalize("NFKC").replace(/\s+/gu, " ").replace(/\s+([,.;:!?])/gu, "$1").trim();
}

function normalizeOcrText(text) {
  let value = text.normalize("NFKC");
  value = value.replace(/\r?\n/gu, " ");
  value = value.replace(/\s+/gu, " ");
  value = value.replace(/(?<=[\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu, "");
  value = value.replace(/(?<=\d)\s*-\s*(?=\d)/gu, "-");
  value = value.replace(/\(\s*([A-Da-d])\s*\)/gu, (_, letter) => `(${letter.toUpperCase()})`);
  value = value.replace(/\s+([,.;:!?])/gu, "$1");
  return value.trim();
}

function countOptionMarkers(text) {
  return [...normalizeOcrText(text).matchAll(/\([A-D]\)/gu)].length;
}

function countQuestionMarkers(text) {
  return [...normalizeOcrText(text).matchAll(/(?:^|\s)\d{1,3}\s*[\.、·](?=\s|$)/gu)].length;
}

function parseTextbookAnswers(pages) {
  const answers = new Map();
  const explanations = new Map();
  for (const page of pages) {
    const lines = page.lines.map((line) => ({ text: line.text }));
    for (const [questionNumber, answerLetter] of parseAnswerPairsFromLines(lines)) answers.set(questionNumber, answerLetter);
    for (const [questionNumber, block] of parseNumberedBlocks(lines)) {
      explanations.set(questionNumber, block);
      const match = block.match(/\(([A-D])\)/u) || block.match(/答案[:：]?\s*([ABCD])/u);
      if (match && !answers.has(questionNumber)) answers.set(questionNumber, match[1]);
    }
  }
  return { answers, explanations };
}

function letterToIndex(letter) {
  return { A: 0, B: 1, C: 2, D: 3 }[letter] ?? 0;
}

function indexToLetter(index) {
  return ["A", "B", "C", "D"][index] ?? "A";
}

async function buildReferenceAnswerIndex() {
  const index = {
    byPrompt: new Map(),
    byPromptOptions: new Map(),
    items: []
  };
  const roots = [path.join(ROOT, "question_jsons"), ROOT];

  for (const baseDir of roots) {
    let entries = [];
    try {
      entries = await walkJsonFiles(baseDir, baseDir === ROOT);
    } catch {
      continue;
    }

    for (const entryPath of entries) {
      const normalizedPath = entryPath.replaceAll(path.sep, "/");
      if (/\/mock_exams\/|\/tck_past_exams\/|^.*exam_.*\.json$/iu.test(normalizedPath)) continue;
      if (/workbook|wk\d+/iu.test(normalizedPath)) continue;

      let parsed;
      try {
        parsed = await readJsonFile(entryPath);
      } catch {
        continue;
      }

      if (!Array.isArray(parsed.questions)) continue;
      indexReferenceQuestions(parsed.questions, index);
    }
  }

  return index;
}

async function walkJsonFiles(dir, topLevelOnly = false) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!topLevelOnly && entry.name !== "assets" && entry.name !== ".git" && entry.name !== "node_modules" && entry.name !== ".codex-tmp") {
        results.push(...(await walkJsonFiles(entryPath, false)));
      }
      continue;
    }
    if (entry.isFile() && /\.json$/iu.test(entry.name)) {
      results.push(entryPath);
    }
  }

  return results;
}

function indexReferenceQuestions(questions, targetIndex = referenceAnswerIndex) {
  for (const question of questions) {
    if (!question?.q || !Array.isArray(question.options) || ![0, 1, 2, 3].includes(question.a)) continue;
    const promptKey = normalizeLookupText(question.q);
    const promptOptionsKey = makePromptOptionsKey(question.q, question.options);
    const payload = {
      prompt: question.q.trim(),
      options: normalizeOptions(question.options),
      a: question.a,
      explanation: typeof question.explanation === "string" && question.explanation.trim()
        ? question.explanation.trim()
        : `自動整理答案：(${indexToLetter(question.a)})`
    };

    if (!targetIndex.byPromptOptions.has(promptOptionsKey)) {
      targetIndex.byPromptOptions.set(promptOptionsKey, payload);
    }
    if (!targetIndex.byPrompt.has(promptKey)) {
      targetIndex.byPrompt.set(promptKey, payload);
    }
    targetIndex.items.push(payload);
  }
}

function resolveAnswerFromReferenceIndex(question) {
  const promptOptionsKey = makePromptOptionsKey(question.prompt, question.options);
  const exact = referenceAnswerIndex.byPromptOptions.get(promptOptionsKey);
  if (exact) return exact;
  const normalizedPrompt = normalizeLookupText(question.prompt);
  const promptOnly = referenceAnswerIndex.byPrompt.get(normalizedPrompt);
  if (promptOnly) return promptOnly;

  const promptSeed = extractWorkbookPromptSeed(question.prompt);
  if (promptSeed) {
    const seeded = referenceAnswerIndex.byPrompt.get(promptSeed);
    if (seeded) return seeded;
  }

  if (!normalizedPrompt && !promptSeed) return null;

  let bestMatch = null;
  let bestScore = 0;
  for (const item of referenceAnswerIndex.items) {
    const candidatePrompt = normalizeLookupText(item.prompt);
    if (!candidatePrompt || candidatePrompt.length < 8) continue;
    const comparablePrompt = promptSeed || normalizedPrompt;
    if (!comparablePrompt) continue;
    if (!comparablePrompt.includes(candidatePrompt) && !candidatePrompt.includes(comparablePrompt)) continue;

    const score = Math.min(comparablePrompt.length, candidatePrompt.length) / Math.max(comparablePrompt.length, candidatePrompt.length);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = item;
    }
  }

  return bestScore >= 0.45 ? bestMatch : null;
}

function makePromptOptionsKey(prompt, options) {
  return `${normalizeLookupText(prompt)}::${options.map((option) => normalizeLookupText(option)).join("|")}`;
}

function normalizeLookupText(text) {
  return normalizeOcrText(String(text || ""))
    .toLowerCase()
    .replace(/[，。；：！？、,.;:!?'"`~\-\s（）()「」【】〔〕\[\]．]/gu, "");
}

function normalizeOptions(options) {
  const normalized = options.map((option) => option.trim());
  while (normalized.length < 4) normalized.push("");
  return normalized.slice(0, 4);
}

function shouldUseReferenceQuestion(question, referenceQuestion) {
  if (!referenceQuestion?.prompt || !Array.isArray(referenceQuestion.options) || referenceQuestion.options.length !== 4) {
    return false;
  }

  if (question.options.length !== 4) return true;
  if (normalizeLookupText(question.prompt) !== normalizeLookupText(referenceQuestion.prompt)) return true;

  return question.options.some((option) => {
    const normalized = normalizeOcrText(option);
    return (
      normalized.length > 24 ||
      countQuestionMarkers(normalized) > 0 ||
      countOptionMarkers(normalized) > 1 ||
      /第\s*\d+\s*章|word|下列何者|下列何種/u.test(normalized)
    );
  });
}

function shouldUseReferenceExplanation(explanation, referenceQuestion) {
  if (!referenceQuestion?.explanation) return false;
  const normalized = normalizeOcrText(explanation);
  return (
    normalized.length > 120 ||
    countQuestionMarkers(normalized) > 0 ||
    /問答題|填充題|第\s*\d+\s*章/u.test(normalized)
  );
}

function extractWorkbookPromptSeed(prompt) {
  const normalized = normalizeOcrText(prompt);
  if (!normalized) return "";

  const sentence = normalized.split(/[。！？?]/u)[0] || normalized;
  const secondQuestionIndex = sentence.slice(4).search(/下列何|何者|何種/u);
  const trimmed = secondQuestionIndex >= 0 ? sentence.slice(0, secondQuestionIndex + 4) : sentence;
  return normalizeLookupText(trimmed);
}

function sanitizeExplanationBlock(block, questionNumber) {
  if (!block) return "";
  let cleaned = normalizeExtractedText(block).replace(new RegExp(`^${questionNumber}[\\.、]\\s*`, "u"), "");
  const nextMarker = cleaned.search(/\s\d{1,3}[\.、]\s/gu);
  if (nextMarker >= 0) {
    cleaned = cleaned.slice(0, nextMarker).trim();
  }
  if (cleaned.length < 4) return "";
  return cleaned;
}

async function maybeCropQuestionImage({ bundleStem, sourcePath, pageNumber, searchTop, searchBottom, lineBoxes, shouldCrop }) {
  if (!shouldCrop) return "";
  const pdf = await openPdf(sourcePath);
  const renderedImagePath = await renderPageImage(pdf, sourcePath, pageNumber, 2);
  const graphicBounds = await detectGraphicBounds({
    sourceImagePath: renderedImagePath,
    searchTop,
    searchBottom,
    lineBoxes,
    scale: 2
  });
  if (!graphicBounds) return "";
  return cropFromRenderedImage({
    bundleStem,
    sourceImagePath: renderedImagePath,
    pageNumber,
    top: graphicBounds.top,
    bottom: graphicBounds.bottom,
    left: graphicBounds.left,
    right: graphicBounds.right
  });
}

async function detectGraphicBounds({ sourceImagePath, searchTop, searchBottom, lineBoxes, scale }) {
  const image = sharp(sourceImagePath);
  const { data, info } = await image
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  const top = clamp(Math.floor(searchTop * scale), 0, height - 1);
  const bottom = clamp(Math.ceil(searchBottom * scale), top + 1, height);
  const mask = new Uint8Array(width * height);

  for (let y = top; y < bottom; y += 1) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      const value = data[rowOffset + x];
      mask[rowOffset + x] = value < 235 ? 1 : 0;
    }
  }

  for (const box of lineBoxes) {
    const boxTop = clamp(Math.floor(box.top * scale) - 6, top, bottom);
    const boxBottom = clamp(Math.ceil(box.bottom * scale) + 6, boxTop, bottom);
    const boxLeft = clamp(Math.floor(box.left * scale) - 12, 0, width - 1);
    const boxRight = clamp(Math.ceil(box.right * scale) + 12, boxLeft + 1, width);
    for (let y = boxTop; y < boxBottom; y += 1) {
      const rowOffset = y * width;
      mask.fill(0, rowOffset + boxLeft, rowOffset + boxRight);
    }
  }

  const visited = new Uint8Array(width * height);
  const components = [];
  const queueX = [];
  const queueY = [];

  for (let y = top; y < bottom; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (mask[idx] === 0 || visited[idx] === 1) continue;

      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let area = 0;
      queueX.length = 0;
      queueY.length = 0;
      queueX.push(x);
      queueY.push(y);
      visited[idx] = 1;

      for (let head = 0; head < queueX.length; head += 1) {
        const cx = queueX[head];
        const cy = queueY[head];
        area += 1;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        const neighbors = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1]
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= width || ny < top || ny >= bottom) continue;
          const nidx = ny * width + nx;
          if (mask[nidx] === 0 || visited[nidx] === 1) continue;
          visited[nidx] = 1;
          queueX.push(nx);
          queueY.push(ny);
        }
      }

      const componentWidth = maxX - minX + 1;
      const componentHeight = maxY - minY + 1;
      if (area >= 180 && componentWidth >= 24 && componentHeight >= 24) {
        components.push({ minX, maxX, minY, maxY, area, componentWidth, componentHeight });
      }
    }
  }

  if (components.length === 0) return null;

  const largestArea = Math.max(...components.map((component) => component.area));
  const significantComponents = components.filter(
    (component) =>
      component.area >= Math.max(180, Math.floor(largestArea * 0.35)) ||
      (component.componentWidth >= 42 &&
        component.componentHeight >= 42 &&
        component.area >= Math.max(120, Math.floor(largestArea * 0.18)))
  );
  const seedComponents = significantComponents.length > 0 ? significantComponents : components;
  const clusters = buildGraphicComponentClusters(seedComponents);
  const bestCluster = clusters.sort((leftCluster, rightCluster) => {
    const areaDelta = rightCluster.totalArea - leftCluster.totalArea;
    if (areaDelta !== 0) return areaDelta;
    return rightCluster.bounds.area - leftCluster.bounds.area;
  })[0];

  let expandedLeft = bestCluster.bounds.left;
  let expandedRight = bestCluster.bounds.right;
  let expandedTop = bestCluster.bounds.top;
  let expandedBottom = bestCluster.bounds.bottom;

  for (const component of components) {
    if (bestCluster.components.includes(component)) continue;
    const horizontalGap = Math.max(0, Math.max(component.minX - expandedRight, expandedLeft - component.maxX));
    const verticalGap = Math.max(0, Math.max(component.minY - expandedBottom, expandedTop - component.maxY));
    const overlapsClusterBand =
      (horizontalGap <= 36 && verticalGap <= 36) ||
      (verticalGap <= 20 && component.componentWidth <= 42 && horizontalGap <= 48) ||
      (horizontalGap <= 20 && component.componentHeight <= 42 && verticalGap <= 48);

    if (!overlapsClusterBand) continue;

    expandedLeft = Math.min(expandedLeft, component.minX);
    expandedRight = Math.max(expandedRight, component.maxX);
    expandedTop = Math.min(expandedTop, component.minY);
    expandedBottom = Math.max(expandedBottom, component.maxY);
  }

  const clusterWidth = expandedRight - expandedLeft + 1;

  for (const box of lineBoxes) {
    if (/^圖\s*[(（]/u.test(normalizeExtractedText(box.text || ""))) continue;
    const boxTop = clamp(Math.floor(box.top * scale) - 8, top, bottom);
    const boxBottom = clamp(Math.ceil(box.bottom * scale) + 8, boxTop + 1, bottom);
    const boxLeft = clamp(Math.floor(box.left * scale) - 16, 0, width - 1);
    const boxRight = clamp(Math.ceil(box.right * scale) + 16, boxLeft + 1, width);
    const boxWidth = boxRight - boxLeft;
    const boxHeight = boxBottom - boxTop;
    const horizontalGap = Math.max(0, Math.max(boxLeft - expandedRight, expandedLeft - boxRight));
    const verticalGap = Math.max(0, Math.max(boxTop - expandedBottom, expandedTop - boxBottom));
    const overlapsAxisBand =
      (horizontalGap <= 96 && boxHeight <= 72) ||
      (verticalGap <= 54 &&
        horizontalGap <= Math.max(120, Math.round(clusterWidth * 0.2)) &&
        boxWidth <= Math.max(220, clusterWidth * 0.4));

    if (!overlapsAxisBand) continue;
    if (boxWidth > Math.max(220, clusterWidth * 0.4)) continue;
    if (boxHeight > 90) continue;

    expandedLeft = Math.min(expandedLeft, boxLeft);
    expandedRight = Math.max(expandedRight, boxRight);
    expandedTop = Math.min(expandedTop, boxTop);
    expandedBottom = Math.max(expandedBottom, boxBottom);
  }

  return {
    left: clamp(expandedLeft - 16, 0, width - 1),
    right: clamp(expandedRight + 17, expandedLeft + 1, width),
    top: clamp(expandedTop - 16, 0, height - 1),
    bottom: clamp(expandedBottom + 17, expandedTop + 1, height)
  };
}

function buildGraphicComponentClusters(components) {
  if (components.length === 0) return [];

  const clusters = [];
  const consumed = new Set();

  for (const component of components) {
    if (consumed.has(component)) continue;

    const clusterComponents = [];
    const queue = [component];
    consumed.add(component);

    while (queue.length > 0) {
      const current = queue.shift();
      clusterComponents.push(current);

      for (const candidate of components) {
        if (consumed.has(candidate) || candidate === current) continue;
        if (!graphicComponentsAreNeighbors(current, candidate)) continue;
        consumed.add(candidate);
        queue.push(candidate);
      }
    }

    const left = Math.min(...clusterComponents.map((item) => item.minX));
    const right = Math.max(...clusterComponents.map((item) => item.maxX));
    const top = Math.min(...clusterComponents.map((item) => item.minY));
    const bottom = Math.max(...clusterComponents.map((item) => item.maxY));
    clusters.push({
      components: clusterComponents,
      totalArea: clusterComponents.reduce((sum, item) => sum + item.area, 0),
      bounds: {
        left,
        right,
        top,
        bottom,
        area: (right - left + 1) * (bottom - top + 1)
      }
    });
  }

  return clusters;
}

function graphicComponentsAreNeighbors(left, right) {
  const horizontalGap = Math.max(0, Math.max(right.minX - left.maxX, left.minX - right.maxX));
  const verticalGap = Math.max(0, Math.max(right.minY - left.maxY, left.minY - right.maxY));
  const horizontalThreshold = Math.max(
    72,
    Math.min(220, Math.round(Math.max(left.componentWidth, right.componentWidth) * 1.2))
  );
  const verticalThreshold = Math.max(
    54,
    Math.min(160, Math.round(Math.max(left.componentHeight, right.componentHeight) * 1.2))
  );

  return horizontalGap <= horizontalThreshold && verticalGap <= verticalThreshold;
}

async function cropFromRenderedImage({ bundleStem, sourceImagePath, pageNumber, top, bottom, left = 0, right = null }) {
  const outputDir = path.join(OUTPUT_IMAGE_DIR, bundleStem);
  await fs.mkdir(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, `p${String(pageNumber).padStart(3, "0")}_${top}_${bottom}_${left}_${right ?? "r"}.png`);
  const metadata = await sharp(sourceImagePath).metadata();
  const width = metadata.width || 1;
  const height = metadata.height || 1;
  const rawTop = clamp(top, 0, height - 1);
  const rawBottom = clamp(bottom, rawTop + 1, height);
  const rawLeft = clamp(left, 0, width - 1);
  const rawRight = clamp(right ?? width, rawLeft + 1, width);
  const paddingX = Math.max(28, Math.round((rawRight - rawLeft) * 0.14));
  const paddingY = Math.max(28, Math.round((rawBottom - rawTop) * 0.14));
  const cropTop = clamp(rawTop - paddingY, 0, height - 1);
  const cropBottom = clamp(rawBottom + paddingY, cropTop + 1, height);
  const cropLeft = clamp(rawLeft - paddingX, 0, width - 1);
  const cropRight = clamp(rawRight + paddingX, cropLeft + 1, width);
  await sharp(sourceImagePath)
    .extract({ left: cropLeft, top: cropTop, width: cropRight - cropLeft, height: cropBottom - cropTop })
    .png()
    .toFile(outputFile);
  return `${RAW_BASE}/${path.relative(ROOT, outputFile).replaceAll(path.sep, "/")}`;
}

async function renderPageImage(pdf, sourcePath, pageNumber, scale = 2) {
  const sourceHash = crypto.createHash("sha1").update(sourcePath).digest("hex").slice(0, 12);
  const scaleTag = String(scale).replace(".", "_");
  const outputPath = path.join(TEMP_DIR, sourceHash, `page_${String(pageNumber).padStart(3, "0")}_s${scaleTag}.png`);
  try {
    await fs.access(outputPath);
    return outputPath;
  } catch {
    // cache miss
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  await page.render({ canvasContext: context, viewport }).promise;
  await fs.writeFile(outputPath, canvas.toBuffer("image/png"));
  return outputPath;
}

async function runOcr(imagePaths) {
  if (imagePaths.length === 0) return [];
  const requestId = `ocr_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const requestPath = path.join(OCR_QUEUE_DIR, `${requestId}.request.json`);
  const responsePath = path.join(OCR_QUEUE_DIR, `${requestId}.response.json`);
  const errorPath = path.join(OCR_QUEUE_DIR, `${requestId}.error.txt`);
  try {
    await fs.writeFile(requestPath, JSON.stringify({
      id: requestId,
      language: "zh-Hant-TW",
      paths: imagePaths
    }), "utf8");
    const responseText = await waitForOcrResponse({ responsePath, errorPath, requestId });
    const parsed = JSON.parse(responseText);
    return Array.isArray(parsed) ? parsed : [parsed];
  } finally {
    await fs.rm(requestPath, { force: true }).catch(() => {});
    await fs.rm(responsePath, { force: true }).catch(() => {});
    await fs.rm(errorPath, { force: true }).catch(() => {});
  }
}

async function waitForOcrResponse({ responsePath, errorPath, requestId, timeoutMs = 10 * 60 * 1000 }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await fs.readFile(responsePath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    try {
      const errorText = await fs.readFile(errorPath, "utf8");
      throw new Error(`OCR worker failed for ${requestId}: ${errorText.trim()}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for OCR worker response: ${requestId}`);
}

function runProcess(command, processArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, processArgs, { cwd: ROOT, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr || `Process failed with exit code ${code}`));
      }
    });
  });
}

function samePath(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function currentDateString() {
  return new Date().toISOString().slice(0, 10);
}

async function updateConfig({ questionBundles, contentBundles }) {
  const config = await readJsonFile(CONFIG_PATH);
  config.data_version = Number(config.data_version || 0) + 1;
  config.bundles = mergeConfigBundles(config.bundles || [], questionBundles, "question");
  config.content_bundles = mergeConfigBundles(config.content_bundles || [], contentBundles, "content");

  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function mergeConfigBundles(existingBundles, incomingBundles, type) {
  const normalizedIncoming = incomingBundles.map(normalizeConfigBundlePaths);
  const incomingById = new Map(normalizedIncoming.map((bundle) => [bundle.id, bundle]));
  const merged = [];

  for (const bundle of (existingBundles || []).map(normalizeConfigBundlePaths)) {
    if (incomingById.has(bundle.id)) {
      merged.push(incomingById.get(bundle.id));
      incomingById.delete(bundle.id);
      continue;
    }
    if (!shouldReplaceExistingBundle(bundle, type)) {
      merged.push(bundle);
    }
  }

  merged.push(...incomingById.values());
  return merged.sort((a, b) => a.file_name.localeCompare(b.file_name, "en"));
}

function shouldReplaceExistingBundle(bundle, type) {
  const fileName = String(bundle.file_name || "").replaceAll("\\", "/");
  const onlyValue = String(args.only || "");

  if (type === "content") {
    if (args.mode === "exams") return false;
    if (!onlyValue) return args.mode === "all" || args.mode === "textbooks";
    return fileName.startsWith("content_jsons/textbooks/");
  }

  if (args.mode === "textbooks") {
    return fileName.startsWith("question_jsons/textbook_exercises/");
  }

  if (!onlyValue) {
    return fileName.startsWith("question_jsons/tck_past_exams/") || fileName.startsWith("question_jsons/mock_exams/");
  }

  if (onlyValue.includes("tck_past_exams")) {
    return fileName.startsWith("question_jsons/tck_past_exams/");
  }
  if (onlyValue.includes("tck_mock_exams") || onlyValue.includes("mock")) {
    return fileName.startsWith("question_jsons/mock_exams/");
  }
  if (onlyValue.endsWith(".pdf")) {
    return false;
  }

  return false;
}

async function cleanupUnusedQuestionImages() {
  const config = await readJsonFile(CONFIG_PATH);
  const bundleJsonPaths = (config.bundles || []).map((bundle) => path.join(ROOT, bundle.file_name));
  const contentJsonPaths = (config.content_bundles || []).map((bundle) => path.join(ROOT, bundle.file_name));

  const referenced = new Set();
  for (const bundlePath of bundleJsonPaths) {
    const bundle = await readJsonFile(bundlePath);
    for (const question of bundle.questions || []) {
      if (typeof question.image_url !== "string" || !question.image_url.startsWith(`${RAW_BASE}/assets/question_images/`)) {
        continue;
      }
      const relPath = question.image_url.slice(`${RAW_BASE}/`.length).replaceAll("/", path.sep);
      referenced.add(path.resolve(ROOT, relPath));
    }
  }

  for (const contentPath of contentJsonPaths) {
    const bundle = await readJsonFile(contentPath);
    for (const page of bundle.pages || []) {
      if (typeof page.page_image_url !== "string" || !page.page_image_url.startsWith(`${RAW_BASE}/assets/content_pages/`)) {
        continue;
      }
      const relPath = page.page_image_url.slice(`${RAW_BASE}/`.length).replaceAll("/", path.sep);
      referenced.add(path.resolve(ROOT, relPath));
    }
  }

  const staleFiles = [];
  const stack = [OUTPUT_IMAGE_DIR, OUTPUT_CONTENT_IMAGE_DIR];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    let entries = [];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (
        entry.isFile() &&
        /\.(png|jpg|jpeg)$/i.test(entry.name) &&
        !referenced.has(path.resolve(entryPath))
      ) {
        staleFiles.push(entryPath);
      }
    }
  }

  for (const staleFile of staleFiles) {
    await fs.rm(staleFile, { force: true });
  }

  await removeEmptyDirectories(OUTPUT_IMAGE_DIR);
  await removeEmptyDirectories(OUTPUT_CONTENT_IMAGE_DIR);
}

async function removeEmptyDirectories(rootDir) {
  let entries = [];
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch {
    return false;
  }
  let hasChildren = false;
  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (!entry.isDirectory()) {
      hasChildren = true;
      continue;
    }
    const childHasChildren = await removeEmptyDirectories(entryPath);
    hasChildren = hasChildren || childHasChildren;
  }

  const remaining = await fs.readdir(rootDir).catch(() => []);
  if (remaining.length === 0 && !samePath(rootDir, OUTPUT_IMAGE_DIR)) {
    await fs.rmdir(rootDir).catch(() => {});
    return false;
  }

  return remaining.length > 0 || hasChildren;
}

async function removeTreeContents(rootDir) {
  let entries = [];
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    await fs.rm(path.join(rootDir, entry.name), { recursive: true, force: true });
  }
}

async function prepareOutputDirectories(options) {
  if (options.mode !== "textbooks") {
    const onlyValue = String(options.only || "");
    const isPdfOnlyRun = onlyValue.endsWith(".pdf");
    const clearTck = !isPdfOnlyRun && (!onlyValue || onlyValue.includes("tck_past_exams"));
    const clearMock = !isPdfOnlyRun && (!onlyValue || onlyValue.includes("tck_mock_exams") || (!clearTck && onlyValue.includes("mock")));
    if (clearMock) {
      await removeTreeContents(MOCK_EXAM_JSON_DIR);
    }
    if (clearTck) {
      await removeTreeContents(TCK_EXAM_JSON_DIR);
    }
  }

  if (options.mode !== "exams") {
    await removeTreeContents(TEXTBOOK_EXERCISE_JSON_DIR);
    await removeTreeContents(TEXTBOOK_CONTENT_JSON_DIR);
  }

  if (options.mode === "all") {
    await removeTreeContents(OUTPUT_IMAGE_DIR);
    await removeTreeContents(OUTPUT_CONTENT_IMAGE_DIR);
  }
}

function normalizeConfigBundlePaths(bundle) {
  const fileName = String(bundle.file_name || "").replaceAll(path.sep, "/");
  return {
    ...bundle,
    file_name: fileName,
    url: `${RAW_BASE}/${fileName}`
  };
}
