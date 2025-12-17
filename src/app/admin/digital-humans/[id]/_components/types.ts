export interface ChatMessage {
  role: "user" | "model"
  parts: { text: string }[]
}

export type DbUser = {
  userid: string
  username: string
  profession?: string | null
  avatar?: string | null
  age?: number | null
  gender?: string | null
  zipcode?: string | null
  bio?: string | null
  system_prompt?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export type DbPost = {
  id: string
  userid: string
  photos: string[] | null
  description?: string | null
  created_at: string
}


