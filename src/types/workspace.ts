/**
 * 工作空间相关的后端数据结构（对应 src-tauri/src/workspace.rs）
 */
export interface ScannedFile {
  /** 相对空间根目录的路径（含文件名，/ 分隔） */
  rel_path: string
  /** 文件头部文本，用来推断标题 */
  head: string
  /** 修改时间（毫秒） */
  modified: number
}

export interface ScanResult {
  files: ScannedFile[]
  /** 相对空间根目录的目录路径（/ 分隔），父目录在前 */
  dirs: string[]
  truncated: boolean
}

/** 跨空间搬运的目标：目标空间 + 目标目录的相对路径（'' = 空间根目录） */
export interface TransferTarget {
  workspaceId: string
  dirRel: string
}

/** 传输弹窗里可选的目标目录 */
export interface TransferDirOption {
  id: string | null
  /** 相对路径，'' 表示根目录 */
  rel: string
  name: string
  depth: number
}
