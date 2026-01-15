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
  personality?: string | null
  zipcode?: string | null
  bio?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export type DbPost = {
  id: string
  userid: string
  photos: string[] | null
  description?: string | null
  occurred_at?: string | null
  location_name?: string | null
  longitude?: number | null
  latitude?: number | null
  deleted_at?: string | null
  created_at: string
}


