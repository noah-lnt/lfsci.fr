import type { VariantProps } from "class-variance-authority"
import { cn } from "cn"
import Link from "next/link"
import type { ComponentProps } from "react"
import { buttonVariants } from "./button"

type LinkButtonProps = ComponentProps<typeof Link> & VariantProps<typeof buttonVariants>

/** A navigation styled as a button stays a real link: role, middle-click, and no Base UI button contract. */
function LinkButton({ className, variant, size, ...props }: LinkButtonProps) {
  return (
    <Link
      data-slot="link-button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { LinkButton }
