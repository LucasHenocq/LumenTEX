import { BookMarked, File, FileCode2, FileImage, FileText, Folder, FolderOpen, Settings } from 'lucide-react'

export default function FileIcon({ name, isDir, open, size = 15 }: { name: string; isDir?: boolean; open?: boolean; size?: number }): React.JSX.Element {
  if (isDir) {
    const I = open ? FolderOpen : Folder
    return <I size={size} className="fi fi-dir" strokeWidth={1.8} />
  }
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'tex') return <FileText size={size} className="fi fi-tex" strokeWidth={1.8} />
  if (ext === 'bib') return <BookMarked size={size} className="fi fi-bib" strokeWidth={1.8} />
  if (['sty', 'cls', 'bst', 'def', 'cfg'].includes(ext)) return <Settings size={size} className="fi fi-sty" strokeWidth={1.8} />
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'eps', 'bmp', 'webp', 'tif', 'tiff'].includes(ext)) return <FileImage size={size} className="fi fi-img" strokeWidth={1.8} />
  if (ext === 'pdf') return <FileImage size={size} className="fi fi-pdf" strokeWidth={1.8} />
  if (['md', 'txt', 'csv', 'dat', 'json', 'yml', 'yaml', 'py', 'js', 'ts'].includes(ext)) return <FileCode2 size={size} className="fi" strokeWidth={1.8} />
  return <File size={size} className="fi" strokeWidth={1.8} />
}
