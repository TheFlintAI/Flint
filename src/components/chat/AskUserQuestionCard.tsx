import * as React from 'react'
import { useState, useCallback, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronRight, ChevronLeft, MessageCircleQuestion } from 'lucide-react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { coerceAskUserQuestions, resolveAskUserAnswers } from '@/lib/tools/ask-user-tool'
import type {
  AskUserQuestionItem,
  AskUserAnswers,
  AskUserAnnotation,
  AskUserResolvedPayload,
  AskUserStructuredResult
} from '@/lib/tools/ask-user-tool'
import type { ToolPanelContext } from '@/lib/tools/tool-render-types'
import type { ToolResultContent } from '@/lib/api/types'
import {
  decodeStructuredToolResult,
  isStructuredToolErrorText
} from '@/lib/tools/tool-result-format'

// ── Types ──────────────────────────────────────────────────────────

interface AnsweredPair {
  question: string
  answer: string
  annotation?: AskUserAnnotation
}

// ── Constants ──────────────────────────────────────────────────────

const RECOMMENDED_OPTION_RE = /\s*(?:\(|\[)?recommended(?:\)|\])?\s*/i

// ── Helpers ────────────────────────────────────────────────────────

function getOptionLabel(label: string | undefined | null): string {
  return typeof label === 'string' ? label : ''
}

function isRecommendedOptionLabel(label: string | undefined | null): boolean {
  return RECOMMENDED_OPTION_RE.test(getOptionLabel(label))
}

function stripRecommendedMarker(label: string | undefined | null): string {
  return getOptionLabel(label).replace(RECOMMENDED_OPTION_RE, '').trim()
}

function outputAsText(output: ToolResultContent | undefined): string | null {
  if (!output) return null
  const text =
    typeof output === 'string'
      ? output
      : output
          .filter((block) => block.type === 'text')
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join('\n')
  return text || null
}

function parseStructuredAnsweredResult(
  output: ToolResultContent | undefined
): AskUserStructuredResult | null {
  const text = outputAsText(output)
  if (!text) return null
  const parsed = decodeStructuredToolResult(text)
  if (!parsed || Array.isArray(parsed)) return null
  if (!parsed.answers || typeof parsed.answers !== 'object' || Array.isArray(parsed.answers))
    return null

  const answers = parsed.answers as Record<string, unknown>
  const normalizedAnswers: Record<string, string> = {}
  for (const [key, value] of Object.entries(answers)) {
    if (typeof value === 'string') {
      normalizedAnswers[key] = value
    }
  }

  const annotationsSource =
    parsed.annotations &&
    typeof parsed.annotations === 'object' &&
    !Array.isArray(parsed.annotations)
      ? (() => {
          const result: Record<string, AskUserAnnotation> = {}
          for (const [key, value] of Object.entries(parsed.annotations as Record<string, unknown>)) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) continue
            const record = value as Record<string, unknown>
            const notes = typeof record.notes === 'string' ? record.notes : undefined
            if (!notes) continue
            result[key] = { notes }
          }
          return Object.keys(result).length > 0 ? result : undefined
        })()
      : undefined

  return {
    questions: Array.isArray(parsed.questions) ? (parsed.questions as AskUserQuestionItem[]) : [],
    answers: normalizedAnswers,
    summary:
      typeof parsed.summary === 'string' ? parsed.summary : 'User has answered your questions.',
    ...(annotationsSource ? { annotations: annotationsSource } : {}),
    ...(typeof parsed.source === 'string' && parsed.source.trim()
      ? { source: parsed.source.trim() }
      : {}),
    ...(parsed.autoAnswered === true ? { autoAnswered: true } : {})
  }
}

function parseAnsweredPairs(output: ToolResultContent | undefined): {
  pairs: AnsweredPair[]
  structured: AskUserStructuredResult | null
} {
  const structured = parseStructuredAnsweredResult(output)
  if (structured) {
    const pairs = Object.entries(structured.answers).map(([question, answer]) => ({
      question,
      answer,
      annotation: structured.annotations?.[question]
    }))
    return { pairs, structured }
  }
  return { pairs: [], structured: null }
}

function questionHasAnswer(
  question: AskUserQuestionItem | undefined,
  selected: Set<string>,
  customText: string
): boolean {
  if (!question) return false
  const pickedCount = [...selected].filter((value) => value !== '__other__').length
  if (pickedCount > 0) return true
  if (selected.has('__other__') && customText.trim()) return true
  return (!question.options || question.options.length === 0) && !!customText.trim()
}

function buildSubmissionPayload(
  questions: AskUserQuestionItem[],
  selections: Map<number, Set<string>>,
  customTexts: Map<number, string>
): AskUserResolvedPayload {
  const answers: AskUserAnswers = {}
  for (let i = 0; i < questions.length; i += 1) {
    const sel = selections.get(i) ?? new Set()
    const custom = customTexts.get(i) ?? ''
    const q = questions[i]
    const picked = [...sel].filter((value) => value !== '__other__')
    if (sel.has('__other__') || !q.options || q.options.length === 0) {
      if (custom.trim()) {
        answers[String(i)] = q.multiSelect ? [...picked, custom.trim()] : custom.trim()
      } else if (picked.length > 0) {
        answers[String(i)] = q.multiSelect ? picked : picked[0]
      }
    } else if (picked.length > 0) {
      answers[String(i)] = q.multiSelect ? picked : picked[0]
    }
  }
  return { answers }
}

// ── Sub-components ─────────────────────────────────────────────────

function StepIndicator({
  questions,
  currentIndex,
  selections,
  customTexts,
  onSelect
}: {
  questions: AskUserQuestionItem[]
  currentIndex: number
  selections: Map<number, Set<string>>
  customTexts: Map<number, string>
  onSelect: (index: number) => void
}): React.JSX.Element | null {
  if (questions.length <= 1) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {questions.map((q, i) => {
        const isActive = i === currentIndex
        const isDone = questionHasAnswer(q, selections.get(i) ?? new Set(), customTexts.get(i) ?? '')
        return (
          <React.Fragment key={`${q.header ?? q.question}-${i}`}>
            {i > 0 && <ChevronRight className="size-3 shrink-0 text-muted-foreground/30" />}
            <button
              type="button"
              onClick={() => onSelect(i)}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
                isActive && 'bg-primary text-primary-foreground',
                isDone && !isActive && 'bg-secondary text-secondary-foreground',
                !isDone && !isActive && 'bg-transparent text-muted-foreground/50 ring-1 ring-inset ring-border/50'
              )}
            >
              {isDone && <Check className="size-3" />}
              {q.header ?? i + 1}
            </button>
          </React.Fragment>
        )
      })}
    </div>
  )
}

function RadioOption({
  value,
  label,
  description,
  isRecommended
}: {
  value: string
  label: string
  description?: string
  isRecommended?: boolean
}): React.JSX.Element {
  const id = React.useId()
  return (
    <label
      htmlFor={id}
      className={cn(
        'group flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer transition-colors',
        'hover:bg-accent/40',
        'has-[[data-state=checked]]:bg-accent/30 has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-border/60'
      )}
    >
      <RadioGroupPrimitive.Item
        id={id}
        value={value}
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-full border transition-all',
          'border-muted-foreground/30 bg-transparent',
          'hover:border-primary/60',
          'data-[state=checked]:border-primary data-[state=checked]:bg-primary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30'
        )}
      >
        <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
          <div className="size-1.5 rounded-full bg-primary-foreground" />
        </RadioGroupPrimitive.Indicator>
      </RadioGroupPrimitive.Item>
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {isRecommended && (
          <span className="ml-1.5 text-[11px] text-muted-foreground/50">(Recommended)</span>
        )}
        {description && (
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground/60">{description}</p>
        )}
      </div>
    </label>
  )
}

function CheckOption({
  checked,
  label,
  description,
  isRecommended,
  onChange
}: {
  checked: boolean
  label: string
  description?: string
  isRecommended?: boolean
  onChange: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onChange}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
        checked ? 'bg-accent/30 ring-1 ring-border/60' : 'hover:bg-accent/40'
      )}
    >
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-sm border transition-all',
          checked
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-muted-foreground/30 bg-transparent'
        )}
      >
        {checked && <Check className="size-3 stroke-[2.5]" />}
      </span>
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {isRecommended && (
          <span className="ml-1.5 text-[11px] text-muted-foreground/50">(Recommended)</span>
        )}
        {description && (
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground/60">{description}</p>
        )}
      </div>
    </button>
  )
}

function QuestionBody({
  index,
  item,
  selected,
  customText,
  onToggle,
  onCustomTextChange,
  onSetSingleSelect,
  disabled
}: {
  index: number
  item: AskUserQuestionItem
  selected: Set<string>
  customText: string
  onToggle: (index: number, value: string) => void
  onCustomTextChange: (index: number, text: string) => void
  onSetSingleSelect: (index: number, value: string) => void
  disabled: boolean
}): React.JSX.Element {
  const { t } = useTranslation('chat')
  const isOtherSelected = selected.has('__other__')
  const isMulti = item.multiSelect === true
  const options = item.options ?? []

  const radioValue = React.useMemo(() => {
    if (isMulti) return undefined
    if (isOtherSelected) return '__other__'
    const picked = [...selected].filter((v) => v !== '__other__')
    return picked[0] ?? ''
  }, [isMulti, isOtherSelected, selected])

  const handleRadioChange = useCallback(
    (value: string) => onSetSingleSelect(index, value),
    [index, onSetSingleSelect]
  )

  const hasOptions = options.length > 0

  return (
    <div className="space-y-2.5">
      <p className="text-sm font-medium leading-snug text-foreground">{item.question}</p>

      {hasOptions && (
        <div className="space-y-0.5">
          {isMulti ? (
            options.map((opt, oi) => {
              const value = getOptionLabel(opt.label)
              if (!value) return null
              return (
                <CheckOption
                  key={oi}
                  checked={selected.has(value)}
                  label={stripRecommendedMarker(opt.label)}
                  description={opt.description}
                  isRecommended={isRecommendedOptionLabel(value)}
                  onChange={() => onToggle(index, value)}
                />
              )
            })
          ) : (
            <RadioGroupPrimitive.Root
              value={radioValue}
              onValueChange={handleRadioChange}
              className="space-y-0.5"
            >
              {options.map((opt, oi) => {
                const value = getOptionLabel(opt.label)
                if (!value) return null
                return (
                  <RadioOption
                    key={oi}
                    value={value}
                    label={stripRecommendedMarker(opt.label)}
                    description={opt.description}
                    isRecommended={isRecommendedOptionLabel(value)}
                  />
                )
              })}
            </RadioGroupPrimitive.Root>
          )}

          {/* "Other" option */}
          <div className={cn(
            'rounded-lg px-3 py-2 transition-colors',
            isOtherSelected ? 'bg-accent/30 ring-1 ring-border/60' : 'hover:bg-accent/40'
          )}>
            <div className="flex items-center gap-3">
              {isMulti ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onToggle(index, '__other__')}
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-sm border transition-all',
                    isOtherSelected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground/30 bg-transparent',
                    disabled && 'cursor-not-allowed opacity-50'
                  )}
                >
                  {isOtherSelected && <Check className="size-3 stroke-[2.5]" />}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (isOtherSelected) onSetSingleSelect(index, '')
                    else handleRadioChange('__other__')
                  }}
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-full border transition-all',
                    isOtherSelected
                      ? 'border-primary bg-primary'
                      : 'border-muted-foreground/30 bg-transparent',
                    disabled && 'cursor-not-allowed opacity-50'
                  )}
                >
                  {isOtherSelected && <div className="size-1.5 rounded-full bg-primary-foreground" />}
                </button>
              )}
              <span className="text-sm font-medium text-foreground">{t('askUser.other')}</span>
            </div>

            {isOtherSelected && (
              <Textarea
                disabled={disabled}
                value={customText}
                onChange={(e) => onCustomTextChange(index, e.target.value)}
                placeholder={t('askUser.answerPlaceholder')}
                rows={3}
                className={cn(
                  'mt-2 min-h-[72px] rounded-md border bg-background/60 text-sm shadow-none',
                  'placeholder:text-muted-foreground/40',
                  'focus-visible:ring-1 focus-visible:ring-ring/20',
                  disabled && 'cursor-not-allowed opacity-50'
                )}
              />
            )}
          </div>
        </div>
      )}

      {!hasOptions && (
        <Textarea
          disabled={disabled}
          value={customText}
          onChange={(e) => onCustomTextChange(index, e.target.value)}
          placeholder={t('askUser.answerPlaceholder')}
          rows={3}
          className={cn(
            'min-h-[72px] rounded-md border bg-background/60 text-sm shadow-none',
            'placeholder:text-muted-foreground/40',
            'focus-visible:ring-1 focus-visible:ring-ring/20',
            disabled && 'cursor-not-allowed opacity-50'
          )}
        />
      )}
    </div>
  )
}

// ── Pending (active form) ──────────────────────────────────────────

function PendingContent({ ctx }: { ctx: ToolPanelContext }): React.JSX.Element {
  const { t } = useTranslation('chat')
  const questions = useMemo(() => coerceAskUserQuestions(ctx.input.questions), [ctx.input.questions])
  const toolUseId = ctx.toolUseId ?? ''

  const [selections, setSelections] = useState<Map<number, Set<string>>>(() => new Map())
  const [customTexts, setCustomTexts] = useState<Map<number, string>>(() => new Map())
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)

  useEffect(() => {
    setSelections(new Map())
    setCustomTexts(new Map())
    setCurrentQuestionIndex(0)
  }, [toolUseId])

  const handleToggle = useCallback(
    (qIdx: number, value: string) => {
      setSelections((prev) => {
        const next = new Map(prev)
        const current = new Set(next.get(qIdx) ?? [])
        const q = questions[qIdx]
        if (value === '__other__') {
          if (current.has('__other__')) {
            current.delete('__other__')
          } else {
            if (!q?.multiSelect) current.clear()
            current.add('__other__')
          }
        } else if (current.has(value)) {
          current.delete(value)
        } else {
          if (!q?.multiSelect) current.clear()
          current.add(value)
          if (!q?.multiSelect) current.delete('__other__')
        }
        next.set(qIdx, current)
        return next
      })
    },
    [questions]
  )

  const handleSetSingleSelect = useCallback(
    (qIdx: number, value: string) => {
      setSelections((prev) => {
        const next = new Map(prev)
        const current = new Set<string>()
        if (value && value !== '') current.add(value)
        next.set(qIdx, current)
        return next
      })
    },
    []
  )

  const handleCustomTextChange = useCallback((qIdx: number, text: string) => {
    setCustomTexts((prev) => {
      const next = new Map(prev)
      next.set(qIdx, text)
      return next
    })
  }, [])

  const handleSubmit = useCallback(() => {
    resolveAskUserAnswers(toolUseId, buildSubmissionPayload(questions, selections, customTexts))
  }, [toolUseId, questions, selections, customTexts])

  const hasCurrentAnswer = useMemo(() => {
    const sel = selections.get(currentQuestionIndex) ?? new Set()
    const custom = customTexts.get(currentQuestionIndex) ?? ''
    return questionHasAnswer(questions[currentQuestionIndex], sel, custom)
  }, [currentQuestionIndex, questions, selections, customTexts])

  const hasAllAnswers = useMemo(() => {
    for (let i = 0; i < questions.length; i += 1) {
      const sel = selections.get(i) ?? new Set()
      const custom = customTexts.get(i) ?? ''
      if (!questionHasAnswer(questions[i], sel, custom)) return false
    }
    return true
  }, [questions, selections, customTexts])

  const isLastQuestion = currentQuestionIndex === questions.length - 1
  const isFirstQuestion = currentQuestionIndex === 0

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return
      const target = event.target
      if (target instanceof HTMLElement) {
        const tagName = target.tagName.toLowerCase()
        const editable = target.getAttribute('contenteditable')
        if (tagName === 'textarea' || tagName === 'input' || editable === 'true') return
      }
      if (event.key === 'ArrowLeft' && questions.length > 1 && !isFirstQuestion) {
        event.preventDefault()
        setCurrentQuestionIndex((value) => Math.max(0, value - 1))
      } else if (event.key === 'ArrowRight' && questions.length > 1 && !isLastQuestion && hasCurrentAnswer) {
        event.preventDefault()
        setCurrentQuestionIndex((value) => Math.min(questions.length - 1, value + 1))
      } else if (event.key === 'Enter' && !event.shiftKey && isLastQuestion && hasAllAnswers) {
        event.preventDefault()
        handleSubmit()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSubmit, hasAllAnswers, hasCurrentAnswer, isFirstQuestion, isLastQuestion, questions.length])

  const currentQuestion = questions[currentQuestionIndex]
  if (!currentQuestion) return <></>

  return (
    <>
      {/* Step indicator */}
      {questions.length > 1 && (
        <div className="mb-4">
          <StepIndicator
            questions={questions}
            currentIndex={currentQuestionIndex}
            selections={selections}
            customTexts={customTexts}
            onSelect={setCurrentQuestionIndex}
          />
        </div>
      )}

      {/* Question body */}
      <QuestionBody
        index={currentQuestionIndex}
        item={currentQuestion}
        selected={selections.get(currentQuestionIndex) ?? new Set()}
        customText={customTexts.get(currentQuestionIndex) ?? ''}
        onToggle={handleToggle}
        onCustomTextChange={handleCustomTextChange}
        onSetSingleSelect={handleSetSingleSelect}
        disabled={false}
      />

      {/* Footer */}
      <div className="mt-4 flex items-center justify-between">
        <div>
          {questions.length > 1 && !isFirstQuestion && (
            <Button
              onClick={() => setCurrentQuestionIndex((v) => Math.max(0, v - 1))}
              variant="ghost" size="xs"
            >
              <ChevronLeft className="size-3.5" />
              {t('askUser.previous')}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {questions.length > 1 && !isLastQuestion && (
            <Button
              onClick={() => setCurrentQuestionIndex((v) => Math.min(questions.length - 1, v + 1))}
              disabled={!hasCurrentAnswer}
              variant="outline" size="xs"
            >
              {t('askUser.next')}
              <ChevronRight className="size-3.5" />
            </Button>
          )}
          {isLastQuestion && (
            <Button onClick={handleSubmit} disabled={!hasAllAnswers} size="xs">
              {t('askUser.submit')}
            </Button>
          )}
        </div>
      </div>
    </>
  )
}

// ── Answered (Q&A summary) ─────────────────────────────────────────

function AnsweredContent({ ctx }: { ctx: ToolPanelContext }): React.JSX.Element {
  const { t } = useTranslation('chat')
  const parsedAnswers = useMemo(() => parseAnsweredPairs(ctx.output), [ctx.output])
  const answeredPairs = parsedAnswers.pairs

  if (answeredPairs.length === 0) {
    return <p className="text-xs text-muted-foreground/60">{t('askUser.answeredSubtitle')}</p>
  }

  return (
    <div className="space-y-2">
      {answeredPairs.map((pair, idx) => (
        <div key={`${pair.question}-${idx}`} className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge className="h-4 shrink-0 rounded px-1 text-[10px] leading-none bg-blue-500/15 text-blue-400 hover:bg-blue-500/15 border-0">
              Q
            </Badge>
            <p className="text-xs leading-5 text-foreground/80">{pair.question}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="h-4 shrink-0 rounded px-1 text-[10px] leading-none bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/15 border-0">
              A
            </Badge>
            <p className="text-xs leading-5 whitespace-pre-wrap break-words text-foreground/70">{pair.answer}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Error / Canceled ───────────────────────────────────────────────

function ErrorContent({ ctx }: { ctx: ToolPanelContext }): React.JSX.Element {
  const { t } = useTranslation('chat')
  const outputText = useMemo(() => outputAsText(ctx.output), [ctx.output])
  const outputErrorMessage = useMemo(() => {
    const text = outputText
    if (!text || !isStructuredToolErrorText(text)) return null
    const parsed = decodeStructuredToolResult(text)
    if (!parsed || Array.isArray(parsed) || typeof parsed.error !== 'string') return null
    return parsed.error
  }, [outputText])

  const isCanceled = ctx.status === 'canceled'
  const subtitle = isCanceled ? t('askUser.canceledSubtitle') : t('askUser.errorSubtitle')

  return (
    <div>
      <p className="text-xs text-muted-foreground/60">{subtitle}</p>
      {(outputErrorMessage ?? outputText) && (
        <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground/70">
          {outputErrorMessage ?? outputText}
        </p>
      )}
    </div>
  )
}

// ── Completed without answers ──────────────────────────────────────

function CompletedContent({ ctx }: { ctx: ToolPanelContext }): React.JSX.Element {
  const outputText = useMemo(() => outputAsText(ctx.output), [ctx.output])
  return (
    <p className="text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground/60">
      {outputText}
    </p>
  )
}

// ── Main Body Component ────────────────────────────────────────────

/**
 * Renders the body content for the AskUserQuestion tool panel.
 * This is the renderBody target for the native-panel render descriptor.
 * ToolShell provides the collapsible container, header, and trailing status.
 */
export function AskUserQuestionBody({ ctx }: { ctx: ToolPanelContext }): React.JSX.Element {
  const questions = useMemo(() => coerceAskUserQuestions(ctx.input.questions), [ctx.input.questions])
  const parsedAnswers = useMemo(() => parseAnsweredPairs(ctx.output), [ctx.output])
  const answeredText = useMemo(() => outputAsText(ctx.output), [ctx.output])
  const outputErrorMessage = useMemo(() => {
    const text = answeredText
    if (!text || !isStructuredToolErrorText(text)) return null
    const parsed = decodeStructuredToolResult(text)
    if (!parsed || Array.isArray(parsed) || typeof parsed.error !== 'string') return null
    return parsed.error
  }, [answeredText])

  const isError = ctx.status === 'error' || !!outputErrorMessage
  const isCanceled = ctx.status === 'canceled'
  const isAnswered = ctx.status === 'completed' && parsedAnswers.pairs.length > 0
  const isPending = !isAnswered && !isError && !isCanceled &&
    (ctx.status === 'streaming' || ctx.status === 'running')
  const isCompletedWithoutAnswers =
    ctx.status === 'completed' && !isAnswered && !isError && !isCanceled && !!answeredText

  if (isError || isCanceled) return <ErrorContent ctx={ctx} />
  if (isAnswered) return <AnsweredContent ctx={ctx} />
  if (isCompletedWithoutAnswers) return <CompletedContent ctx={ctx} />
  if (!isPending || questions.length === 0) return <></>

  return <PendingContent ctx={ctx} />
}
