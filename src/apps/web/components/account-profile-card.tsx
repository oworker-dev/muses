"use client"

import {
  ChangeEvent,
  FormEvent,
  useId,
  useRef,
  useState,
  useTransition,
} from "react"
import {
  CheckCircle2Icon,
  Edit3Icon,
  Loader2Icon,
  UploadIcon,
  UserCircleIcon,
  XIcon,
} from "lucide-react"
import { useRouter } from "next/navigation"

import { StatusBadge } from "@/components/status-badge"
import { SuccessAlert } from "@/components/status-alert"
import { Alert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"

export type AccountProfileCardCopy = {
  title: string
  detail: string
  edit: string
  cancel: string
  save: string
  nameLabel: string
  imageLabel: string
  uploadAvatar: string
  uploadingAvatar: string
  profileUpdated: string
  avatarUpdated: string
  unsupportedType: string
  tooLarge: string
  error: string
}

export function AccountProfileCard({
  id,
  name,
  fallbackName,
  email,
  image,
  status,
  statusTone,
  verified,
  verifiedLabel,
  memberSince,
  accountId,
  accountType,
  signInMethods,
  labels,
  copy,
}: {
  id: string
  name?: string | null
  fallbackName: string
  email: string
  image?: string | null
  status: string
  statusTone: "ok" | "warning"
  verified: boolean
  verifiedLabel: string
  memberSince: string
  accountId: string
  accountType: string
  signInMethods: string
  labels: {
    memberSince: string
    accountId: string
    accountType: string
    signInMethods: string
  }
  copy: AccountProfileCardCopy
}) {
  const router = useRouter()
  const imageInputId = useId()
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [displayName, setDisplayName] = useState(name || "")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [isSaving, startSaving] = useTransition()
  const [isUploading, setIsUploading] = useState(false)
  const shownName = displayName || fallbackName

  function beginEdit() {
    setMessage("")
    setError("")
    setDisplayName(name || "")
    setEditing(true)
  }

  function cancelEdit() {
    setMessage("")
    setError("")
    setDisplayName(name || "")
    setEditing(false)
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage("")
    setError("")
    const nextName = displayName.trim()
    if (!nextName) {
      setError(copy.error)
      return
    }

    startSaving(async () => {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: nextName }),
      })

      if (!response.ok) {
        setError(await readError(response, copy.error))
        return
      }

      setDisplayName(nextName)
      setEditing(false)
      setMessage(copy.profileUpdated)
      router.refresh()
    })
  }

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
    setMessage("")
    setError("")
    const file = event.target.files?.[0] || null
    event.target.value = ""
    if (!file) {
      return
    }

    if (
      !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
        file.type
      )
    ) {
      setError(copy.unsupportedType)
      return
    }

    if (file.size > 2 * 1024 * 1024) {
      setError(copy.tooLarge)
      return
    }

    setIsUploading(true)
    try {
      const uploadResponse = await fetch("/api/account/avatar/upload", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
          size: file.size,
        }),
      })

      if (!uploadResponse.ok) {
        throw new Error(await readError(uploadResponse, copy.error))
      }

      const uploadPayload = (await uploadResponse.json()) as {
        upload: AvatarUpload
      }
      const upload = uploadPayload.upload
      const putResponse = await fetch(upload.url, {
        method: upload.method,
        headers: upload.headers,
        body: file,
      })

      if (!putResponse.ok) {
        throw new Error(copy.error)
      }

      const confirmResponse = await fetch("/api/account/avatar/confirm", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ key: upload.key }),
      })

      if (!confirmResponse.ok) {
        throw new Error(await readError(confirmResponse, copy.error))
      }

      setMessage(copy.avatarUpdated)
      router.refresh()
    } catch (avatarError) {
      setError(avatarError instanceof Error ? avatarError.message : copy.error)
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <Card id={id} className="h-full overflow-hidden">
      <CardHeader className="px-5 py-0">
        <div className="flex items-center gap-3">
          <UserCircleIcon className="size-5" />
          <div>
            <CardTitle>{copy.title}</CardTitle>
            <CardDescription className="sr-only">{copy.detail}</CardDescription>
          </div>
        </div>
        <CardAction>
          {editing ? (
            <Button type="button" variant="ghost" onClick={cancelEdit}>
              <XIcon />
              {copy.cancel}
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={beginEdit}>
              <Edit3Icon />
              {copy.edit}
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4 px-5 py-0">
        <div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-center">
          <div className="relative size-20 shrink-0 overflow-hidden rounded-full border bg-background">
            {editing ? (
              <label
                htmlFor={imageInputId}
                className="group grid size-full cursor-pointer place-items-center overflow-hidden"
              >
                <AvatarVisual image={image} label={shownName || email} />
                <span className="absolute inset-0 grid place-items-center bg-black/55 px-2 text-center text-xs font-medium text-white opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                  {isUploading ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2Icon className="size-3 animate-spin" />
                      {copy.uploadingAvatar}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <UploadIcon className="size-3" />
                      {copy.uploadAvatar}
                    </span>
                  )}
                </span>
              </label>
            ) : (
              <AvatarVisual image={image} label={shownName || email} />
            )}
            <input
              ref={imageInputRef}
              id={imageInputId}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              aria-label={copy.imageLabel}
              className="sr-only"
              disabled={!editing || isUploading}
              onChange={uploadAvatar}
            />
          </div>

          {editing ? (
            <form onSubmit={saveProfile} className="grid min-w-0 gap-4">
              <div className="grid gap-2">
                <label
                  htmlFor="account-profile-name"
                  className="text-sm font-medium"
                >
                  {copy.nameLabel}
                </label>
                <Input
                  id="account-profile-name"
                  value={displayName}
                  maxLength={80}
                  onChange={(event) => setDisplayName(event.target.value)}
                  required
                />
              </div>
              <p className="text-sm break-all text-muted-foreground">{email}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? (
                    <Loader2Icon className="animate-spin" />
                  ) : (
                    <CheckCircle2Icon />
                  )}
                  {copy.save}
                </Button>
                <Button type="button" variant="outline" onClick={cancelEdit}>
                  {copy.cancel}
                </Button>
              </div>
            </form>
          ) : (
            <div className="min-w-0">
              <h2 className="text-xl font-semibold break-words">{shownName}</h2>
              <p className="mt-1 text-sm break-all text-muted-foreground">
                {email}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusBadge tone={statusTone}>{status}</StatusBadge>
                {verified ? (
                  <StatusBadge tone="ok">{verifiedLabel}</StatusBadge>
                ) : null}
              </div>
            </div>
          )}
        </div>

        <FormMessage message={message} error={error} />

        <div className="border-t" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <PlainMetric label={labels.memberSince} value={memberSince} />
          <PlainMetric label={labels.accountId} value={accountId} />
          <PlainMetric label={labels.accountType} value={accountType} />
          <PlainMetric label={labels.signInMethods} value={signInMethods} />
        </div>
      </CardContent>
    </Card>
  )
}

function AvatarVisual({
  image,
  label,
}: {
  image?: string | null
  label: string
}) {
  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Avatar URLs can come from any configured S3-compatible public endpoint.
      <img
        src={image}
        alt=""
        className="size-full object-cover"
        referrerPolicy="no-referrer"
      />
    )
  }

  return (
    <span className="grid size-full place-items-center text-2xl font-semibold">
      {getInitials(label)}
    </span>
  )
}

function PlainMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium break-words text-foreground">
        {value}
      </p>
    </div>
  )
}

function FormMessage({ message, error }: { message: string; error: string }) {
  if (!message && !error) {
    return null
  }

  return (
    <>
      {message ? <SuccessAlert>{message}</SuccessAlert> : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </>
  )
}

function getInitials(value: string) {
  const initials = value
    .replace(/@.*$/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase()

  return initials || "U"
}

async function readError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null)
  return payload?.message || payload?.error?.message || fallback
}

type AvatarUpload = {
  key: string
  method: "PUT"
  url: string
  headers: Record<string, string>
}
