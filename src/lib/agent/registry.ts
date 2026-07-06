/**
 * Generic Registry base class — subscribable Map with lazy-cached snapshots.
 * ToolRegistry and AgentRegistry both follow this pattern; extracting it here
 * keeps the subscribe/emit/cache-invalidation logic in one place.
 */
export class Registry<T> {
  protected items = new Map<string, T>()
  private listeners = new Set<() => void>()
  private allCache: T[] | null = []
  private namesCache: string[] | null = []

  protected invalidate(): void {
    this.allCache = null
    this.namesCache = null
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  register(name: string, item: T): boolean {
    const prev = this.items.get(name)
    this.items.set(name, item)
    if (prev !== item) {
      this.invalidate()
      this.emit()
      return true
    }
    return false
  }

  unregister(name: string): boolean {
    if (this.items.delete(name)) {
      this.invalidate()
      this.emit()
      return true
    }
    return false
  }

  get(name: string): T | undefined {
    return this.items.get(name)
  }

  has(name: string): boolean {
    return this.items.has(name)
  }

  getAll(): T[] {
    if (!this.allCache) {
      this.allCache = Array.from(this.items.values())
    }
    return this.allCache
  }

  getNames(): string[] {
    if (!this.namesCache) {
      this.namesCache = Array.from(this.items.keys())
    }
    return this.namesCache
  }

  get size(): number {
    return this.items.size
  }
}
