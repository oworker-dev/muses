"use client"

import Image, { type ImageProps } from "next/image"
import { useTheme } from "next-themes"
import { useState } from "react"

import { cn } from "@/lib/utils"

type BrandLogoProps = Omit<ImageProps, "src" | "alt"> & {
  alt?: string
  lightSrc?: string
  darkSrc?: string
}

const defaultLightSrc = "/logo.svg"
const defaultDarkSrc = "/logo-dark.svg"

export function BrandLogo({
  lightSrc = defaultLightSrc,
  darkSrc = defaultDarkSrc,
  alt = "",
  className,
  onError,
  ...props
}: BrandLogoProps) {
  const { resolvedTheme } = useTheme()
  const [unavailableDarkSrc, setUnavailableDarkSrc] = useState<string | null>(
    null
  )
  const src =
    resolvedTheme === "dark" && unavailableDarkSrc !== darkSrc
      ? darkSrc
      : lightSrc

  return (
    <Image
      src={src}
      alt={alt}
      className={cn("shrink-0 object-contain", className)}
      onError={(event) => {
        if (src === darkSrc) {
          setUnavailableDarkSrc(darkSrc)
        }
        onError?.(event)
      }}
      {...props}
    />
  )
}
