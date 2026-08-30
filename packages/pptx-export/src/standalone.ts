import { validateDocument, type AssetAdapter, type Ppt4aiDocument } from '@ppt4ai/model'
import { writeStoredZip, type ZipEntry } from './zip.js'
import {
  serializeAppPropertiesXml,
  serializeContentTypesXml,
  serializeCorePropertiesXml,
  serializeEmptySlideXml,
  serializeLayoutRelationshipsXml,
  serializeLayoutSlideRelationshipsXml,
  serializeLayoutXml,
  serializeMasterRelationshipsXml,
  serializeMasterXml,
  serializePresentationRelationshipsXml,
  serializePresentationSupportXml,
  serializePresentationXml,
  serializeRootRelationshipsXml,
  serializeThemeXml,
} from './standalone-xml.js'

export interface CreatePptxOptions {
  assetAdapter?: AssetAdapter
}

function documentValidationError(document: Ppt4aiDocument): Error | undefined {
  const validation = validateDocument(document)
  return validation.valid ? undefined : new Error(`PPTX generation document invalid: ${validation.errors.join('; ')}`)
}

function skeletonEntries(document: Ppt4aiDocument): ZipEntry[] {
  const slideCount = document.slideOrder.length
  const support = serializePresentationSupportXml()
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: new TextEncoder().encode(serializeContentTypesXml(slideCount, new Set())) },
    { name: '_rels/.rels', data: new TextEncoder().encode(serializeRootRelationshipsXml()) },
    { name: 'docProps/core.xml', data: new TextEncoder().encode(serializeCorePropertiesXml()) },
    { name: 'docProps/app.xml', data: new TextEncoder().encode(serializeAppPropertiesXml()) },
    { name: 'ppt/presentation.xml', data: new TextEncoder().encode(serializePresentationXml(document.page, slideCount)) },
    { name: 'ppt/_rels/presentation.xml.rels', data: new TextEncoder().encode(serializePresentationRelationshipsXml(slideCount)) },
    { name: 'ppt/presProps.xml', data: new TextEncoder().encode(support.presProps) },
    { name: 'ppt/viewProps.xml', data: new TextEncoder().encode(support.viewProps) },
    { name: 'ppt/theme/theme1.xml', data: new TextEncoder().encode(serializeThemeXml()) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: new TextEncoder().encode(serializeMasterXml()) },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: new TextEncoder().encode(serializeMasterRelationshipsXml()) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: new TextEncoder().encode(serializeLayoutXml()) },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: new TextEncoder().encode(serializeLayoutRelationshipsXml()) },
  ]
  for (let index = 0; index < slideCount; index += 1) {
    entries.push(
      { name: `ppt/slides/slide${index + 1}.xml`, data: new TextEncoder().encode(serializeEmptySlideXml()) },
      { name: `ppt/slides/_rels/slide${index + 1}.xml.rels`, data: new TextEncoder().encode(serializeLayoutSlideRelationshipsXml()) },
    )
  }
  return entries
}

export async function createPptx(document: Ppt4aiDocument, _options: CreatePptxOptions = {}): Promise<Uint8Array> {
  const error = documentValidationError(document)
  if (error) throw error
  return writeStoredZip(skeletonEntries(document))
}
