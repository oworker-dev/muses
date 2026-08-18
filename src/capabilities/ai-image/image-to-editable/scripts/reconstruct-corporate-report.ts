import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import sharp from "sharp"

import {
  EDITABLE_SCENE_SCHEMA_VERSION,
  type EditableSceneManifest,
  type ReconstructionQa,
  type SceneAsset,
  type SceneLayer,
} from "../../src/image-to-editable.js"

const CANVAS = { width: 1672, height: 941 } as const
const DEEP_BLUE = "#062c78"
const INK = "#061c55"
const MUTED = "#53647f"
const BORDER = "#d6e0ef"

type CliOptions = { input: string; output: string }

type RasterSources = {
  readonly city: string
  readonly waves: string
  readonly logo: string
}

type TextOptions = {
  id: string
  x: number
  y: number
  text: string
  size?: number
  fill?: string
  weight?: number
  anchor?: "start" | "middle" | "end"
  family?: string
  opacity?: number
  transform?: string
  className?: string
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  await mkdir(path.join(options.output, "assets"), { recursive: true })

  const source = await sharp(options.input).metadata()
  if (source.width !== CANVAS.width || source.height !== CANVAS.height) {
    throw new Error(
      `Fixture expects ${CANVAS.width}x${CANVAS.height}; received ${source.width}x${source.height}.`,
    )
  }

  const sourceBytes = await readFile(options.input)
  const sourceSha256 = sha256(sourceBytes)
  const rasterAssets = await extractRasterLayers(options)
  const rasterSources: RasterSources = {
    city: await dataUri(path.join(options.output, "assets/hero-city.png")),
    waves: await dataUri(path.join(options.output, "assets/hero-waves.png")),
    logo: await dataUri(path.join(options.output, "assets/brand-mark.png")),
  }
  const svg = buildSvg(rasterSources)
  const svgPath = path.join(options.output, "editable.svg")
  await writeFile(svgPath, svg, "utf8")

  const previewPath = path.join(options.output, "preview.png")
  await sharp(Buffer.from(svg)).png().toFile(previewPath)

  const previewAsset = await readAsset(
    "preview",
    previewPath,
    "preview.png",
    "preview",
  )
  const svgAsset: SceneAsset = {
    id: "editable-svg",
    path: "editable.svg",
    mimeType: "image/svg+xml",
    width: CANVAS.width,
    height: CANVAS.height,
    sha256: sha256(Buffer.from(svg)),
    role: "svg",
  }

  const structuralSummary = {
    nativeTextElements: count(svg, /<text\b/g),
    vectorShapeElements: count(
      svg,
      /<(?:rect|circle|ellipse|line|polyline|polygon|path)\b/g,
    ),
    rasterLayerElements: count(svg, /<image\b/g),
    embedsFullSourceImage: false as const,
  }

  const manifest: EditableSceneManifest = {
    schemaVersion: EDITABLE_SCENE_SCHEMA_VERSION,
    capability: "image.to-editable.v1",
    fixture: {
      id: "corporate-report-2024",
      sourceName: path.basename(options.input),
      sourceSha256,
    },
    canvas: { ...CANVAS, colorSpace: "srgb" },
    assets: [...rasterAssets, previewAsset, svgAsset],
    layers: sceneLayers(),
    exports: { svg: "editable.svg", preview: "preview.png" },
    structuralSummary,
    limitations: [
      "This is a fixture-driven reconstruction, not a general VLM extraction pipeline.",
      "The skyline, wave, and brand mark remain replaceable raster layers.",
      "KaiTi/Noto CJK font substitution can change calligraphic title metrics across hosts.",
      "Provider-backed clean-background and transparent-redraw stages were not available in this execution environment.",
    ],
  }
  await writeFile(
    path.join(options.output, "scene-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )

  const qa = await evaluate(options.input, previewPath, manifest)
  await writeFile(
    path.join(options.output, "qa.json"),
    `${JSON.stringify(qa, null, 2)}\n`,
  )
  await writeFile(path.join(options.output, "README.md"), evidenceReadme(qa))

  process.stdout.write(
    `${JSON.stringify({ svg: svgPath, preview: previewPath, qa }, null, 2)}\n`,
  )
}

function parseArgs(args: string[]): CliOptions {
  const input = valueAfter(args, "--input")
  const output = valueAfter(args, "--output")
  if (!input || !output) {
    throw new Error("Usage: --input <png> --output <directory>")
  }
  const invocationDirectory = process.env.INIT_CWD
    ? path.resolve(process.env.INIT_CWD)
    : process.cwd()
  return {
    input: path.resolve(invocationDirectory, input),
    output: path.resolve(invocationDirectory, output),
  }
}

function valueAfter(args: string[], flag: string) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

async function extractRasterLayers(options: CliOptions): Promise<SceneAsset[]> {
  const assetsDir = path.join(options.output, "assets")
  const cityPath = path.join(assetsDir, "hero-city.png")
  const wavesPath = path.join(assetsDir, "hero-waves.png")
  const logoPath = path.join(assetsDir, "brand-mark.png")

  await extractWithFade(options.input, cityPath, {
    left: 630,
    top: 65,
    width: 380,
    height: 409,
    fadeLeft: 70,
    fadeTop: 18,
  })
  await extractWithFade(options.input, wavesPath, {
    left: 0,
    top: 384,
    width: 1010,
    height: 90,
    fadeTop: 24,
  })
  await extractNearWhite(options.input, logoPath, {
    left: 27,
    top: 16,
    width: 51,
    height: 49,
  })

  return Promise.all([
    readAsset("hero-city", cityPath, "assets/hero-city.png", "raster-layer"),
    readAsset(
      "hero-waves",
      wavesPath,
      "assets/hero-waves.png",
      "raster-layer",
    ),
    readAsset(
      "brand-mark",
      logoPath,
      "assets/brand-mark.png",
      "raster-layer",
    ),
  ])
}

async function extractWithFade(
  input: string,
  output: string,
  region: {
    left: number
    top: number
    width: number
    height: number
    fadeLeft?: number
    fadeTop?: number
  },
) {
  const { data, info } = await sharp(input)
    .extract(region)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const fadeLeft = region.fadeLeft ?? 0
  const fadeTop = region.fadeTop ?? 0
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels
      const alphaIndex = offset + 3
      const horizontal = fadeLeft > 0 ? Math.min(1, x / fadeLeft) : 1
      const vertical = fadeTop > 0 ? Math.min(1, y / fadeTop) : 1
      const currentAlpha = data[alphaIndex] ?? 255
      data[alphaIndex] = Math.round(currentAlpha * horizontal * vertical)
    }
  }

  await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toFile(output)
}

async function extractNearWhite(
  input: string,
  output: string,
  region: { left: number; top: number; width: number; height: number },
) {
  const { data, info } = await sharp(input)
    .extract(region)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  for (let index = 0; index < data.length; index += info.channels) {
    const red = data[index] ?? 255
    const green = data[index + 1] ?? 255
    const blue = data[index + 2] ?? 255
    const distance = Math.sqrt(
      (255 - red) ** 2 + (255 - green) ** 2 + (255 - blue) ** 2,
    )
    const alpha = Math.max(0, Math.min(255, ((distance - 10) / 72) * 255))
    data[index + 3] = Math.round(alpha)
  }

  await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toFile(output)
}

async function readAsset(
  id: string,
  absolutePath: string,
  relativePath: string,
  role: SceneAsset["role"],
): Promise<SceneAsset> {
  const bytes = await readFile(absolutePath)
  const metadata = await sharp(bytes).metadata()
  if (!metadata.width || !metadata.height) {
    throw new Error(`Could not inspect ${absolutePath}`)
  }
  return {
    id,
    path: relativePath,
    mimeType: "image/png",
    width: metadata.width,
    height: metadata.height,
    sha256: sha256(bytes),
    role,
  }
}

function buildSvg(raster: RasterSources) {
  const parts = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="1672" height="941" viewBox="0 0 1672 941" role="img" aria-labelledby="title description">`,
    `<title id="title">智创未来 2024 年度工作总结可编辑重建</title>`,
    `<desc id="description">普通文字、指标卡、图表、路线与价值观均为可编辑 SVG 元素；城市、波纹与品牌标记是独立可替换图片层。</desc>`,
    defs(),
    `<g id="layer-background" data-layer-name="背景">`,
    `<rect width="1672" height="941" fill="#f8fbff"/>`,
    `<rect x="0" y="0" width="1010" height="474" fill="url(#hero-bg)"/>`,
    `<rect x="1010" y="0" width="662" height="941" fill="#ffffff"/>`,
    `<rect x="0" y="474" width="1010" height="467" fill="url(#lower-bg)"/>`,
    mountainShapes(),
    `</g>`,
    `<g id="layer-hero-raster" data-layer-name="城市与波纹图层">`,
    `<image id="asset-hero-city" data-asset-path="assets/hero-city.png" href="${raster.city}" x="630" y="65" width="380" height="409" preserveAspectRatio="none"/>`,
    `<image id="asset-hero-waves" data-asset-path="assets/hero-waves.png" href="${raster.waves}" x="0" y="384" width="1010" height="90" preserveAspectRatio="none"/>`,
    `</g>`,
    heroContent(raster.logo),
    rightDashboard(),
    lowerLeftStrategy(),
    lowerCenterRoadmap(),
    lowerRightChart(),
    footer(),
    `</svg>`,
  ]
  return `${parts.join("\n")}\n`
}

function defs() {
  return `<defs>
    <linearGradient id="hero-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.62" stop-color="#f4f9ff"/>
      <stop offset="1" stop-color="#dbeeff"/>
    </linearGradient>
    <linearGradient id="lower-bg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.5" stop-color="#f9fbff"/>
      <stop offset="1" stop-color="#edf5ff"/>
    </linearGradient>
    <linearGradient id="header-bar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#0757ce"/>
      <stop offset="0.22" stop-color="#173fa6"/>
      <stop offset="1" stop-color="#dceaff" stop-opacity="0.25"/>
    </linearGradient>
    <linearGradient id="footer-blue" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#0b3c99"/>
      <stop offset="0.56" stop-color="#06276f"/>
      <stop offset="1" stop-color="#0068d7"/>
    </linearGradient>
    <linearGradient id="icon-cyan" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0871d4"/>
      <stop offset="1" stop-color="#27c9c4"/>
    </linearGradient>
    <linearGradient id="icon-purple" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6a45c8"/>
      <stop offset="1" stop-color="#ae65d3"/>
    </linearGradient>
    <linearGradient id="icon-orange" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f09a24"/>
      <stop offset="1" stop-color="#d94b20"/>
    </linearGradient>
    <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#1f4c8a" flood-opacity="0.13"/>
    </filter>
    <clipPath id="footer-clip"><path d="M785 837H1672V941H753L785 837Z"/></clipPath>
  </defs>`
}

function mountainShapes() {
  return `<g id="background-mountains" opacity="0.62">
    <path d="M0 255L58 210L95 229L144 177L217 245L290 220L345 273L414 238L492 303L0 303Z" fill="#d8eafa"/>
    <path d="M0 287L72 246L115 270L168 221L245 293L316 256L397 315L485 271L560 330L0 330Z" fill="#bdd9f3" opacity="0.55"/>
    <path d="M380 324L458 269L506 292L564 251L635 330L700 286L774 341L850 296L934 358L380 358Z" fill="#c9def3" opacity="0.55"/>
  </g>`
}

function heroContent(logo: string) {
  return `<g id="layer-hero-copy" data-layer-name="品牌与主标题">
    <image id="asset-brand-mark" data-asset-path="assets/brand-mark.png" href="${logo}" x="27" y="16" width="51" height="49"/>
    ${text({ id: "company-cn", x: 83, y: 42, text: "智创未来科技有限公司", size: 21, fill: "#111827", weight: 700 })}
    ${text({ id: "company-en", x: 84, y: 56, text: "ZHI CHUANG FUTURE TECHNOLOGY CO., LTD.", size: 7.5, fill: "#303b4f", weight: 500 })}
    ${text({ id: "brand-slogan", x: 738, y: 54, text: "智启新程 · 创领未来", size: 18, fill: DEEP_BLUE, weight: 700 })}
    <path id="brand-chevrons" d="M934 37h10l13 16-13 16h-10l13-16-13-16Zm16 0h10l13 16-13 16h-10l13-16-13-16Zm16 0h10l13 16-13 16h-10l13-16-13-16Z" fill="#4f82c6" opacity="0.78" transform="scale(.82) translate(210 8)"/>
    ${text({ id: "hero-title-1", x: 65, y: 177, text: "聚势而上", size: 82, fill: DEEP_BLUE, weight: 700, family: "'STKaiti','KaiTi','Noto Serif CJK SC',serif", transform: "rotate(-2 65 177)" })}
    ${text({ id: "hero-title-2", x: 231, y: 285, text: "智创未来", size: 82, fill: DEEP_BLUE, weight: 700, family: "'STKaiti','KaiTi','Noto Serif CJK SC',serif", transform: "rotate(1 231 285)" })}
    <line x1="59" y1="323" x2="87" y2="323" stroke="#0a397e" stroke-width="2"/>
    ${text({ id: "hero-subtitle", x: 93, y: 331, text: "2024年度工作总结暨2025年度战略规划报告", size: 22, fill: INK, weight: 700 })}
    <line x1="555" y1="323" x2="578" y2="323" stroke="#0a397e" stroke-width="2"/>
    ${heroFeature(61, "创新驱动", "bulb")}
    ${heroFeature(191, "数据赋能", "data")}
    ${heroFeature(328, "协同共赢", "people")}
    ${heroFeature(465, "持续增长", "growth")}
  </g>`
}

function heroFeature(x: number, label: string, icon: string) {
  return `<g id="hero-feature-${icon}" transform="translate(${x} 363)">
    <circle cx="10" cy="8" r="8" fill="none" stroke="#0d5bd6" stroke-width="2"/>
    <path d="M6 8h8M10 4v8" stroke="#0d5bd6" stroke-width="1.5" opacity="${icon === "bulb" ? 1 : 0}"/>
    ${text({ id: `hero-feature-${icon}-label`, x: 26, y: 14, text: label, size: 17, fill: "#083f9b", weight: 600 })}
  </g>`
}

function rightDashboard() {
  const stats = [
    { label: "营业收入", value: "28.6", unit: "亿元", growth: "23.7%", icon: "¥" },
    { label: "净利润", value: "4.32", unit: "亿元", growth: "31.2%", icon: "DB" },
    { label: "客户总数", value: "12,842", unit: "家", growth: "19.8%", icon: "人" },
    { label: "研发投入", value: "3.15", unit: "亿元", growth: "28.6%", icon: "R" },
  ]
  return `<g id="layer-right-dashboard" data-layer-name="经营数据与业务结构">
    ${sectionHeader(1033, 29, 619, "2024年度核心成果概览")}
    <rect x="1033" y="78" width="619" height="136" rx="13" fill="#fff" stroke="${BORDER}"/>
    ${stats.map((item, index) => statCard(1034 + index * 154.5, 91, index, item)).join("\n")}
    ${sectionHeader(1033, 236, 619, "业务结构分布")}
    ${donutChart()}
  </g>`
}

function statCard(
  x: number,
  y: number,
  index: number,
  item: { label: string; value: string; unit: string; growth: string; icon: string },
) {
  return `<g id="stat-${index}">
    ${index > 0 ? `<line x1="${x}" y1="88" x2="${x}" y2="201" stroke="#e7edf5"/>` : ""}
    <circle cx="${x + 36}" cy="${y + 20}" r="15" fill="#0a5bd5"/>
    ${text({ id: `stat-${index}-icon`, x: x + 36, y: y + 26, text: item.icon, size: item.icon.length > 1 ? 9 : 17, fill: "#fff", weight: 700, anchor: "middle" })}
    ${text({ id: `stat-${index}-label`, x: x + 60, y: y + 25, text: item.label, size: 14, fill: "#1d2b43", weight: 600 })}
    ${text({ id: `stat-${index}-value`, x: x + 22, y: y + 73, text: item.value, size: 29, fill: "#0644ab", weight: 700 })}
    ${text({ id: `stat-${index}-unit`, x: x + 89, y: y + 72, text: item.unit, size: 11, fill: "#0754c8", weight: 600 })}
    ${text({ id: `stat-${index}-growth-label`, x: x + 22, y: y + 104, text: "同比增长", size: 12, fill: "#26364f", weight: 500 })}
    ${text({ id: `stat-${index}-growth-value`, x: x + 88, y: y + 104, text: `▲ ${item.growth}`, size: 12, fill: "#24702a", weight: 600 })}
  </g>`
}

function donutChart() {
  const segments = [
    { label: "智能制造解决方案", value: 40.2, color: "#0758c9" },
    { label: "企业数字化服务", value: 28.7, color: "#2ab083" },
    { label: "工业互联网平台", value: 18.3, color: "#7642be" },
    { label: "智能硬件产品", value: 9.6, color: "#ef921d" },
    { label: "其他业务", value: 3.2, color: "#e35339" },
  ]
  const radius = 74
  const circumference = 2 * Math.PI * radius
  let offset = 0
  const circles = segments
    .map((segment, index) => {
      const length = (segment.value / 100) * circumference
      const result = `<circle id="donut-segment-${index}" cx="1200" cy="378" r="${radius}" fill="none" stroke="${segment.color}" stroke-width="46" stroke-dasharray="${length.toFixed(2)} ${(circumference - length).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 1200 378)"/>`
      offset += length
      return result
    })
    .join("\n")
  const legend = segments
    .map(
      (segment, index) => `<g id="donut-legend-${index}">
        <circle cx="1383" cy="${310 + index * 33}" r="5" fill="${segment.color}"/>
        ${text({ id: `donut-label-${index}`, x: 1398, y: 315 + index * 33, text: segment.label, size: 13, fill: "#1e293b", weight: 500 })}
        ${text({ id: `donut-value-${index}`, x: 1595, y: 315 + index * 33, text: `${segment.value}%`, size: 13, fill: "#1e293b", weight: 500, anchor: "end" })}
      </g>`,
    )
    .join("\n")
  return `<g id="business-donut">
    ${circles}
    <circle cx="1200" cy="378" r="51" fill="#ffffff"/>
    ${text({ id: "donut-total", x: 1200, y: 388, text: "28.6", size: 34, fill: "#0644ab", weight: 700, anchor: "middle" })}
    ${text({ id: "donut-unit", x: 1200, y: 410, text: "亿元", size: 12, fill: "#0754c8", weight: 600, anchor: "middle" })}
    ${text({ id: "donut-caption", x: 1200, y: 428, text: "总营收", size: 11, fill: MUTED, weight: 500, anchor: "middle" })}
    ${legend}
  </g>`
}

function lowerLeftStrategy() {
  const rows = [
    ["创新驱动发展", "持续加大研发投入，突破关键核心技术，", "构建自主可控的技术体系。", "#0967d6", "↗"],
    ["深化数字化转型", "以数据为核心，驱动业务流程优化与", "管理效率全面提升。", "url(#icon-cyan)", "◎"],
    ["拓展生态合作", "携手合作伙伴共建产业生态，打造", "开放共赢的协同发展格局。", "url(#icon-purple)", "合"],
    ["提升全球竞争力", "加速海外市场布局，提升品牌影响力，", "实现全球化可持续增长。", "url(#icon-orange)", "↗"],
  ] as const
  return `<g id="layer-strategy" data-layer-name="战略方向与目标">
    ${sectionHeader(18, 488, 360, "战略方向与目标")}
    ${rows.map((row, index) => strategyRow(20, 530 + index * 65, index, row[0], row[1], row[2], row[3], row[4])).join("\n")}
  </g>`
}

function strategyRow(
  x: number,
  y: number,
  index: number,
  title: string,
  line1: string,
  line2: string,
  fill: string,
  icon: string,
) {
  return `<g id="strategy-${index}">
    <rect x="${x}" y="${y}" width="326" height="61" rx="10" fill="#ffffff" stroke="#d7e1ed"/>
    <rect x="${x + 17}" y="${y + 7}" width="49" height="47" rx="11" fill="${fill}"/>
    ${text({ id: `strategy-${index}-icon`, x: x + 41.5, y: y + 38, text: icon, size: 23, fill: "#fff", weight: 700, anchor: "middle" })}
    ${text({ id: `strategy-${index}-title`, x: x + 82, y: y + 22, text: title, size: 14, fill: "#0751bd", weight: 700 })}
    ${text({ id: `strategy-${index}-line1`, x: x + 82, y: y + 40, text: line1, size: 10.5, fill: "#1f2937", weight: 500 })}
    ${text({ id: `strategy-${index}-line2`, x: x + 82, y: y + 54, text: line2, size: 10.5, fill: "#1f2937", weight: 500 })}
  </g>`
}

function lowerCenterRoadmap() {
  const phases = [
    ["Q1 夯实基础", ["完善组织架构", "优化产品体系", "强化人才储备"]],
    ["Q2 加速增长", ["推进重点项目落地", "拓展核心市场", "提升运营效率"]],
    ["Q3 扩大优势", ["深化生态合作", "扩大市场份额", "增强品牌影响力"]],
    ["Q4 实现突破", ["实现业绩突破", "探索新兴业务", "布局未来增长点"]],
  ] as const
  const capabilities = [
    ["技术创新", "突破核心技术", "增强产品竞争力", "#0758c9", "脑"],
    ["数据智能", "构建数据中台", "驱动智能决策", "#1699c6", "数"],
    ["安全可信", "强化信息安全", "保障业务稳健", "#7a43c4", "盾"],
    ["人才发展", "完善培养体系", "激发组织活力", "#df5b1e", "人"],
  ] as const
  return `<g id="layer-roadmap" data-layer-name="2025重点战略举措">
    ${sectionHeader(390, 488, 584, "2025年度重点战略举措（路线图）")}
    ${phases.map((phase, index) => phaseCard(400 + index * 143, 539, index, phase[0], phase[1])).join("\n")}
    <rect x="400" y="666" width="6" height="17" rx="2" fill="#0a55c6"/>
    ${text({ id: "capabilities-heading", x: 419, y: 681, text: "核心能力建设", size: 17, fill: DEEP_BLUE, weight: 700 })}
    ${capabilities.map((item, index) => capabilityCard(412 + index * 137, 691, index, item[0], item[1], item[2], item[3], item[4])).join("\n")}
  </g>`
}

function phaseCard(
  x: number,
  y: number,
  index: number,
  heading: string,
  bullets: readonly string[],
) {
  const width = 142
  return `<g id="phase-${index}">
    <path d="M${x} ${y}H${x + width - 16}L${x + width} ${y + 15}L${x + width - 16} ${y + 30}H${x}Z" fill="${index % 2 === 0 ? "#0a55c6" : "#1644a3"}"/>
    ${text({ id: `phase-${index}-heading`, x: x + width / 2 - 4, y: y + 21, text: heading, size: 14, fill: "#fff", weight: 700, anchor: "middle" })}
    <rect x="${x}" y="${y + 30}" width="${width}" height="82" fill="#fff" stroke="#d3deec"/>
    ${bullets.map((bullet, bulletIndex) => `${text({ id: `phase-${index}-bullet-${bulletIndex}`, x: x + 18, y: y + 51 + bulletIndex * 21, text: `• ${bullet}`, size: 11, fill: "#26354d", weight: 500 })}`).join("\n")}
  </g>`
}

function capabilityCard(
  x: number,
  y: number,
  index: number,
  heading: string,
  line1: string,
  line2: string,
  color: string,
  icon: string,
) {
  return `<g id="capability-${index}">
    <rect x="${x}" y="${y}" width="104" height="112" rx="6" fill="#fff" stroke="#d5dfeb"/>
    <circle cx="${x + 52}" cy="${y + 37}" r="28" fill="#fff" stroke="${color}" stroke-width="1.5"/>
    <circle cx="${x + 52}" cy="${y + 37}" r="18" fill="${color}"/>
    ${text({ id: `capability-${index}-icon`, x: x + 52, y: y + 43, text: icon, size: 14, fill: "#fff", weight: 700, anchor: "middle" })}
    ${text({ id: `capability-${index}-heading`, x: x + 52, y: y + 78, text: heading, size: 13, fill: color, weight: 700, anchor: "middle" })}
    ${text({ id: `capability-${index}-line1`, x: x + 52, y: y + 94, text: line1, size: 9.5, fill: "#25344d", weight: 500, anchor: "middle" })}
    ${text({ id: `capability-${index}-line2`, x: x + 52, y: y + 107, text: line2, size: 9.5, fill: "#25344d", weight: 500, anchor: "middle" })}
  </g>`
}

function lowerRightChart() {
  const years = ["2022", "2023", "2024", "2025E"]
  const revenue = [16.5, 20, 28.6, 35]
  const profit = [2.45, 3.29, 4.32, 5.8]
  const margin = [14.8, 15.1, 15.1, 16.6]
  const xs = [1115, 1245, 1385, 1525]
  const baseline = 777
  const yRevenue = (value: number) => baseline - (value / 40) * 190
  const yMargin = (value: number) => baseline - (value / 20) * 190
  const linePoints = xs.map((x, index) => `${x + 20},${yMargin(margin[index] ?? 0)}`).join(" ")
  return `<g id="layer-growth-chart" data-layer-name="业绩增长趋势">
    ${sectionHeader(1012, 488, 640, "2022-2025年业绩增长趋势")}
    <g id="chart-legend">
      <rect x="1041" y="541" width="17" height="9" fill="#0753c5"/>
      ${text({ id: "legend-revenue", x: 1066, y: 551, text: "营业收入（亿元）", size: 12, fill: "#26354d", weight: 500 })}
      <rect x="1180" y="541" width="17" height="9" fill="#36b0ba"/>
      ${text({ id: "legend-profit", x: 1205, y: 551, text: "净利润（亿元）", size: 12, fill: "#26354d", weight: 500 })}
      <line x1="1340" y1="546" x2="1367" y2="546" stroke="#7042bd" stroke-width="2"/>
      <circle cx="1354" cy="546" r="4" fill="#7042bd" stroke="#fff"/>
      ${text({ id: "legend-margin", x: 1375, y: 551, text: "净利率（%）", size: 12, fill: "#26354d", weight: 500 })}
    </g>
    <line x1="1049" y1="777" x2="1608" y2="777" stroke="#b7c4d4"/>
    <line x1="1049" y1="587" x2="1049" y2="777" stroke="#b7c4d4"/>
    <line x1="1608" y1="587" x2="1608" y2="777" stroke="#b7c4d4"/>
    ${[0, 10, 20, 30].map((tick) => `<g><line x1="1049" y1="${baseline - (tick / 40) * 190}" x2="1608" y2="${baseline - (tick / 40) * 190}" stroke="#e6ebf2"/><text x="1038" y="${baseline - (tick / 40) * 190 + 5}" text-anchor="end" font-size="11" fill="#627087">${tick}</text></g>`).join("\n")}
    ${[0, 5, 10, 15, 20].map((tick) => text({ id: `right-axis-${tick}`, x: 1620, y: baseline - (tick / 20) * 190 + 5, text: `${tick}%`, size: 11, fill: "#627087", weight: 500 })).join("\n")}
    ${years.map((year, index) => chartBars(xs[index] ?? 0, baseline, index, year, revenue[index] ?? 0, profit[index] ?? 0, yRevenue)).join("\n")}
    <polyline id="margin-line" points="${linePoints}" fill="none" stroke="#7042bd" stroke-width="2.5"/>
    ${xs.map((x, index) => `<g id="margin-${index}"><circle cx="${x + 20}" cy="${yMargin(margin[index] ?? 0)}" r="6" fill="#7042bd" stroke="#fff" stroke-width="1.5"/>${text({ id: `margin-label-${index}`, x: x + 20 + (index === 3 ? 34 : 0), y: yMargin(margin[index] ?? 0) - 13 + (index === 3 ? 23 : 0), text: `${margin[index]}%`, size: 11, fill: "#273569", weight: 600, anchor: "middle" })}</g>`).join("\n")}
  </g>`
}

function chartBars(
  x: number,
  baseline: number,
  index: number,
  year: string,
  revenue: number,
  profit: number,
  yRevenue: (value: number) => number,
) {
  const revenueTop = yRevenue(revenue)
  const profitTop = yRevenue(profit)
  return `<g id="year-${index}">
    <rect x="${x}" y="${revenueTop}" width="37" height="${baseline - revenueTop}" fill="#0753c5"/>
    <rect x="${x + 43}" y="${profitTop}" width="37" height="${baseline - profitTop}" fill="#36b0ba"/>
    ${text({ id: `revenue-${index}`, x: x + 18.5, y: revenueTop - 9, text: revenue.toFixed(1), size: 11, fill: "#0742a8", weight: 700, anchor: "middle" })}
    ${text({ id: `profit-${index}`, x: x + 61.5, y: profitTop - 9, text: profit.toFixed(2), size: 11, fill: "#23334f", weight: 600, anchor: "middle" })}
    ${text({ id: `year-label-${index}`, x: x + 40, y: baseline + 23, text: year, size: 12, fill: "#26354d", weight: 500, anchor: "middle" })}
  </g>`
}

function footer() {
  const values = [
    ["客户至上", "以客户为中心", "创造价值", "客"],
    ["诚信担当", "诚信正直", "勇于担当", "诚"],
    ["合作共赢", "开放协同", "互利共赢", "合"],
    ["创新进取", "追求卓越", "持续创新", "创"],
    ["激情奋斗", "热爱工作", "成就梦想", "心"],
  ] as const
  return `<g id="layer-footer" data-layer-name="企业价值观与愿景">
    ${sectionHeader(18, 826, 750, "企业价值观")}
    ${values.map((item, index) => valueItem(35 + index * 145, 866, index, item[0], item[1], item[2], item[3])).join("\n")}
    <path d="M785 837H1672V941H753L785 837Z" fill="url(#footer-blue)"/>
    <g clip-path="url(#footer-clip)" opacity="0.28">
      <path d="M1050 935C1230 850 1440 905 1690 828" fill="none" stroke="#5aaeff" stroke-width="3"/>
      <path d="M1110 948C1300 872 1470 906 1690 854" fill="none" stroke="#fff" stroke-opacity="0.55"/>
      <circle cx="1540" cy="872" r="54" fill="none" stroke="#65b7ff"/>
      <circle cx="1540" cy="872" r="82" fill="none" stroke="#65b7ff" stroke-opacity="0.5"/>
    </g>
    ${text({ id: "quote-mark", x: 862, y: 910, text: "“", size: 70, fill: "#e6b94e", weight: 700 })}
    ${text({ id: "vision-line-1", x: 921, y: 881, text: "我们致力于成为全球领先的智能制造与数字化解决方案提供商，", size: 16, fill: "#fff", weight: 500 })}
    ${text({ id: "vision-line-2", x: 921, y: 910, text: "以科技创新推动产业进步，让智能连接未来，让价值创造无限可能！", size: 16, fill: "#fff", weight: 500 })}
    ${text({ id: "footer-slogan", x: 1575, y: 907, text: "智创未来", size: 40, fill: "#fff", weight: 700, anchor: "middle", family: "'STKaiti','KaiTi','Noto Serif CJK SC',serif", transform: "rotate(-3 1575 907)" })}
  </g>`
}

function valueItem(
  x: number,
  y: number,
  index: number,
  heading: string,
  line1: string,
  line2: string,
  icon: string,
) {
  return `<g id="value-${index}">
    <circle cx="${x + 22}" cy="${y + 25}" r="22" fill="#0b4196"/>
    ${text({ id: `value-${index}-icon`, x: x + 22, y: y + 32, text: icon, size: 15, fill: "#fff", weight: 700, anchor: "middle" })}
    ${text({ id: `value-${index}-heading`, x: x + 55, y: y + 17, text: heading, size: 15, fill: DEEP_BLUE, weight: 700 })}
    ${text({ id: `value-${index}-line1`, x: x + 55, y: y + 37, text: line1, size: 11, fill: "#24334b", weight: 500 })}
    ${text({ id: `value-${index}-line2`, x: x + 55, y: y + 53, text: line2, size: 11, fill: "#24334b", weight: 500 })}
  </g>`
}

function sectionHeader(x: number, y: number, width: number, title: string) {
  return `<g class="section-header">
    <rect x="${x}" y="${y}" width="${width}" height="33" rx="8" fill="url(#header-bar)"/>
    <rect x="${x + 8}" y="${y + 4}" width="4" height="25" rx="2" fill="#fff" opacity="0.72"/>
    ${text({ id: `section-${slug(title)}`, x: x + 22, y: y + 23, text: title, size: 18, fill: "#fff", weight: 700 })}
  </g>`
}

function text(options: TextOptions) {
  const attributes = [
    `id="${escapeXml(options.id)}"`,
    options.className ? `class="${escapeXml(options.className)}"` : "",
    `x="${options.x}"`,
    `y="${options.y}"`,
    `font-family="${escapeXml(options.family ?? "'Noto Sans CJK SC','Microsoft YaHei','PingFang SC',sans-serif")}"`,
    `font-size="${options.size ?? 14}"`,
    `font-weight="${options.weight ?? 500}"`,
    `fill="${options.fill ?? INK}"`,
    `text-anchor="${options.anchor ?? "start"}"`,
    `letter-spacing="0"`,
    options.opacity === undefined ? "" : `opacity="${options.opacity}"`,
    options.transform ? `transform="${escapeXml(options.transform)}"` : "",
  ]
    .filter(Boolean)
    .join(" ")
  return `<text ${attributes}>${escapeXml(options.text)}</text>`
}

function sceneLayers(): SceneLayer[] {
  return [
    layer("background", "渐变背景与山形", "background", 0, true, 0, 0, 1672, 941),
    layer("hero-city", "城市天际线", "raster-layer", 10, true, 630, 65, 380, 409, "hero-city"),
    layer("hero-waves", "蓝色波纹", "raster-layer", 20, true, 0, 384, 1010, 90, "hero-waves"),
    layer("brand-mark", "品牌标记", "raster-layer", 30, true, 27, 16, 51, 49, "brand-mark"),
    layer("hero-copy", "品牌与主标题", "group", 40, true, 59, 20, 930, 365),
    layer("right-dashboard", "经营数据与业务结构", "group", 50, true, 1033, 29, 619, 440),
    layer("strategy", "战略方向与目标", "group", 60, true, 18, 488, 360, 303),
    layer("roadmap", "2025重点战略举措", "group", 70, true, 390, 488, 584, 315),
    layer("growth-chart", "业绩增长趋势", "group", 80, true, 1012, 488, 640, 313),
    layer("footer", "企业价值观与愿景", "group", 90, true, 18, 826, 1654, 115),
  ]
}

function layer(
  id: string,
  name: string,
  type: SceneLayer["type"],
  zIndex: number,
  editable: boolean,
  x: number,
  y: number,
  width: number,
  height: number,
  assetId?: string,
): SceneLayer {
  return {
    id,
    name,
    type,
    zIndex,
    editable,
    logicalBBox: { x, y, width, height },
    ...(assetId ? { assetId } : {}),
  }
}

async function evaluate(
  sourcePath: string,
  previewPath: string,
  manifest: EditableSceneManifest,
): Promise<ReconstructionQa> {
  const source = await sharp(sourcePath).removeAlpha().raw().toBuffer()
  const rendered = await sharp(previewPath).removeAlpha().raw().toBuffer()
  if (source.length !== rendered.length) {
    throw new Error("Rendered preview dimensions do not match the source.")
  }
  let absoluteError = 0
  let renderedSignal = 0
  for (let index = 0; index < source.length; index += 1) {
    absoluteError += Math.abs((source[index] ?? 0) - (rendered[index] ?? 0))
    renderedSignal += rendered[index] ?? 0
  }
  const meanAbsoluteError = absoluteError / source.length
  const similarity = Math.max(0, 1 - meanAbsoluteError / 255)
  const nonBlank = renderedSignal / rendered.length < 252

  return {
    schemaVersion: "1.0",
    source: CANVAS,
    rendered: CANVAS,
    structural: manifest.structuralSummary,
    pixels: {
      nonBlank,
      meanAbsoluteError: Number(meanAbsoluteError.toFixed(4)),
      similarity: Number(similarity.toFixed(4)),
    },
    checks: {
      dimensionsMatch: true,
      previewIsNonBlank: nonBlank,
      nativeTextPresent: manifest.structuralSummary.nativeTextElements >= 70,
      vectorChartsPresent: manifest.structuralSummary.vectorShapeElements >= 70,
      rasterLayersAreBounded: manifest.structuralSummary.rasterLayerElements === 3,
      noFullSourceEmbedding: !manifest.structuralSummary.embedsFullSourceImage,
      manifestHasEditableGroups: manifest.layers.filter((item) => item.editable).length >= 9,
    },
  }
}

function evidenceReadme(qa: ReconstructionQa) {
  return `# Corporate Report Editable SVG Evidence

Generated from \`/root/a.png\` by the fixture-driven
\`image.to-editable.v1\` vertical slice.

## Outputs

- \`editable.svg\`: layered editable SVG
- \`preview.png\`: rasterized SVG preview
- \`scene-manifest.json\`: host-neutral scene and asset manifest
- \`qa.json\`: structural and pixel checks
- \`assets/\`: separate replaceable raster layers

## Editable Surface

- ${qa.structural.nativeTextElements} native SVG text elements
- ${qa.structural.vectorShapeElements} native SVG vector shapes
- ${qa.structural.rasterLayerElements} bounded raster layers
- Full source image embedded: ${qa.structural.embedsFullSourceImage}

The skyline, waves, and brand mark remain raster layers because they are
complex low-edit-value visuals. All ordinary copy, KPI values, legends, donut
segments, roadmap cards, bars, line chart, and footer content are editable SVG.

Pixel similarity is ${qa.pixels.similarity}; this fixture prioritizes structural
editability and layout fidelity over pixel-identical tracing.
`
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex")
}

async function dataUri(filePath: string) {
  const bytes = await readFile(filePath)
  return `data:image/png;base64,${bytes.toString("base64")}`
}

function count(value: string, expression: RegExp) {
  return value.match(expression)?.length ?? 0
}

function slug(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 10)
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

await main()
