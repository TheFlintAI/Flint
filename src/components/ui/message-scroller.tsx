"use client"

import * as React from "react"
import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from "@shadcn/react/message-scroller"

import { ArrowDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

function Provider(
  props: React.ComponentProps<typeof MessageScrollerPrimitive.Provider>
) {
  return <MessageScrollerPrimitive.Provider {...props} />
}

function Root({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  return (
    <MessageScrollerPrimitive.Root
      data-slot="message-scroller"
      className={cn(
        "group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden",
        className
      )}
      {...props}
    />
  )
}

function Viewport({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  return (
    <MessageScrollerPrimitive.Viewport
      data-slot="message-scroller-viewport"
      className={cn(
        "size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain",
        className
      )}
      {...props}
    />
  )
}

function Content({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return (
    <MessageScrollerPrimitive.Content
      data-slot="message-scroller-content"
      className={cn("flex h-max min-h-full flex-col", className)}
      {...props}
    />
  )
}

function Item({
  className,
  scrollAnchor = false,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  return (
    <MessageScrollerPrimitive.Item
      data-slot="message-scroller-item"
      scrollAnchor={scrollAnchor}
      className={cn(
        "min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem] [content-visibility:auto]",
        className
      )}
      {...props}
    />
  )
}

function Button_({
  direction = "end",
  className,
  children,
  render,
  variant = "secondary",
  size = "icon-sm",
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Button> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <MessageScrollerPrimitive.Button
      data-slot="message-scroller-button"
      data-direction={direction}
      direction={direction}
      className={cn(
        "absolute inset-x-1/2 z-10 -translate-x-1/2 rounded-full border border-border/70 bg-background/90 text-muted-foreground shadow-lg backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:text-foreground hover:shadow-xl",
        "data-[active=false]:pointer-events-none data-[active=false]:translate-y-full data-[active=false]:opacity-0",
        "data-[active=true]:translate-y-0 data-[active=true]:opacity-100",
        "data-[direction=end]:bottom-4",
        "data-[direction=start]:top-4 data-[direction=start]:[&_svg]:rotate-180",
        className
      )}
      render={
        render ?? <Button variant={variant} size={size} />
      }
      {...props}
    >
      {children ?? (
        <>
          <ArrowDown className="size-3" />
          <span className="sr-only">
            {direction === "end" ? "Scroll to latest" : "Scroll to top"}
          </span>
        </>
      )}
    </MessageScrollerPrimitive.Button>
  )
}

// Export as a compound component matching the @shadcn/react API
const MessageScroller = {
  Provider,
  Root,
  Viewport,
  Content,
  Item,
  Button: Button_,
} as const

// Also export the flat names for convenience
const MessageScrollerProvider = Provider
const MessageScrollerViewport = Viewport
const MessageScrollerContent = Content
const MessageScrollerItem = Item
const MessageScrollerButton = Button_

export {
  MessageScroller,
  MessageScrollerProvider,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
}
