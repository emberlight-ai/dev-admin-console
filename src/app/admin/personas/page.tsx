'use client'

import * as React from "react"
import { toast } from "sonner"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronRight, SlidersHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type Gender = "Female" | "Male"
type KeyRow = {
  gender: string
  personality: string
  created_at: string
}

export default function SystemPromptsPage() {
  const router = useRouter()
  const [genderFilter, setGenderFilter] = React.useState<Gender>("Female")
  const [loading, setLoading] = React.useState(true)
  const [keys, setKeys] = React.useState<KeyRow[]>([])

  const fetchKeys = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/system-prompts/keys?gender=${encodeURIComponent(genderFilter)}`
      )
      const json = (await res.json()) as { data?: KeyRow[]; error?: string }
      if (!res.ok) throw new Error(json.error || "Failed to load prompts")
      setKeys(json.data ?? [])
    } catch (err: unknown) {
      console.error(err)
      setKeys([])
      toast.error(err instanceof Error ? err.message : "Failed to load prompts")
    } finally {
      setLoading(false)
    }
  }, [genderFilter])

  React.useEffect(() => {
    void fetchKeys()
  }, [fetchKeys])

  const empty = !loading && keys.length === 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Personas</h1>
        <p className="text-sm text-muted-foreground">
          The persona is HOW SHE TALKS — prose only, versioned per edit. Availability, pacing and follow-ups live on Strategies.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Tabs
          value={genderFilter}
          onValueChange={(v) => {
            if (v === "Female" || v === "Male") setGenderFilter(v)
          }}
        >
          <TabsList>
            <TabsTrigger value="Female">Female</TabsTrigger>
            <TabsTrigger value="Male">Male</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex gap-2">
          <Link href="/admin/config">
            <Button variant="outline" className="gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              Configuration
            </Button>
          </Link>
          <Link href="/admin/personas/manage">
            <Button>+ Personality</Button>
          </Link>
        </div>
      </div>

      {empty ? (
        <Card className="p-10 text-center">
          <div className="text-sm text-muted-foreground">No prompts yet.</div>
        </Card>
      ) : (
        <Card className="p-0">
          <div className="border-b p-4">
            <div className="text-sm font-medium">Latest prompt per key</div>
            <div className="text-xs text-muted-foreground">{loading ? "Loading..." : `${keys.length} personalities`}</div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Gender</TableHead>
                <TableHead>Personality</TableHead>
                <TableHead className="w-10" aria-label="Open" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : keys.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                    No prompts found.
                  </TableCell>
                </TableRow>
              ) : (
                keys.map((k) => (
                  <TableRow
                    key={`${k.gender}::${k.personality}`}
                    className="cursor-pointer hover:bg-muted/30"
                    onClick={() =>
                      router.push(
                        `/admin/personas/manage?gender=${encodeURIComponent(k.gender)}&personality=${encodeURIComponent(k.personality)}`
                      )
                    }
                  >
                    <TableCell>{k.gender}</TableCell>
                    <TableCell className="font-medium">{k.personality}</TableCell>
                    <TableCell className="text-right">
                      <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
