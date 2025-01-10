import { RemoteFileData, RemoteFileChunkData } from "../interface"

export function useFileChunkRegistry(onComplete: (content: string, name: string) => void) {
  const receivingFiles: Record<string, { name: string, length: number, chunks: string[] }> = {}

  function register(data: RemoteFileData) {
    console.log("register file chunk", data)
    receivingFiles[data.id] = { name: data.name, length: data.length, chunks: [] }
  }

  function receiveChunk(data: RemoteFileChunkData) {
    if (!receivingFiles[data.id])
      return

    receivingFiles[data.id].chunks[data.index] = data.content
    if (receivingFiles[data.id].chunks.length !== receivingFiles[data.id].length)
      return

    const content = receivingFiles[data.id].chunks.join('')
    const name = receivingFiles[data.id].name
    delete receivingFiles[data.id]

    console.log("complete file chunk", content, name)
    onComplete(content, name)
  }

  return {
    register,
    receiveChunk,
  }
}

export function chunkFile(content: string, chunkSize = 65536) {
  const chunks: string[] = []
  while (content.length > 0) {
    chunks.push(content.slice(0, chunkSize))
    content = content.slice(chunkSize)
  }

  return chunks
}