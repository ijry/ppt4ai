export { serializeTableXml } from './table.js'
export { rewriteThemeXml } from './theme-writeback.js'
export {
  rewriteColorMapXml,
  rewriteLayoutXml,
  rewriteMasterXml,
  rewritePlaceholderPartXml,
  rewriteSlideColorMapXml,
} from './master-layout-writeback.js'
export { exportPptx } from './writeback.js'
export type { ExportPptxOptions } from './writeback.js'
export { createPptx } from './standalone.js'
export type { CreatePptxOptions } from './standalone.js'
export {
  allocateMediaPath,
  allocateRelationshipId,
  imageExtension,
  replacePictureRelationship,
  serializeImageRelationship,
  serializePictureXml,
  stableAssetId,
} from './image-writeback.js'
