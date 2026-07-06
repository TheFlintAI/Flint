// AST node types for the prompt template engine.

export interface TextNode {
  type: 'text'
  value: string
}

export interface InterpolationNode {
  type: 'interpolation'
  expr: string
}

export interface IfNode {
  type: 'if'
  inverted: boolean
  expr: string
  body: Node[]
  elseBody: Node[]
}

export interface EachNode {
  type: 'each'
  expr: string
  body: Node[]
  elseBody: Node[]
}

export interface WithNode {
  type: 'with'
  expr: string
  body: Node[]
}

export interface PartialNode {
  type: 'partial'
  name: string
}

export interface CommentNode {
  type: 'comment'
}

export type Node =
  | TextNode
  | InterpolationNode
  | IfNode
  | EachNode
  | WithNode
  | PartialNode
  | CommentNode

export type BlockNode = IfNode | EachNode | WithNode
