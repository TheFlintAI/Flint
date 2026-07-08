/**
 * VNode constructors — shared between Worker runtime and test utilities.
 *
 * Each method returns a plain JSON VNode tree:
 *   { type: string, props?: object, children?: VNode[] }
 *
 * This is the SINGLE SOURCE OF TRUTH for VNode constructors.
 * Adding a new component must be done here — the runtime and test utils
 * both consume this file.
 */

function makeNode(type, props, children) {
  const node = { type }
  if (props !== undefined) node.props = props
  if (children !== undefined) node.children = children
  return node
}

export function createVNodeFactory() {
  return {
    // Display components
    card(p)      { return makeNode('card', p) },
    sparkline(p) { return makeNode('sparkline', p) },
    badge(p)     { return makeNode('badge', p) },
    table(p)     { return makeNode('table', p) },

    // Chart sub-namespace — grouped family sharing ChartProps
    chart: {
      pie(p)  { return makeNode('pie-chart', p) },
      bar(p)  { return makeNode('bar-chart', p) },
      area(p) { return makeNode('area-chart', p) },
      line(p) { return makeNode('line-chart', p) },
    },

    // Layout components
    grid(p, c)   { return makeNode('grid', p, c) },
    row(c)       { return makeNode('row', undefined, c) },
    col(c)       { return makeNode('col', undefined, c) },
    heading(t)   { return makeNode('heading', { text: t }) },
    text(t)      { return makeNode('text', { text: t }) },

    // Interactive input components
    input(p)         { return makeNode('input', p) },
    textarea(p)      { return makeNode('textarea', p) },
    select(p)        { return makeNode('select', p) },
    number(p)        { return makeNode('number', p) },
    checkbox(p)      { return makeNode('checkbox', p) },
    switch(p)        { return makeNode('switch', p) },
    toggleGroup(p)   { return makeNode('toggle-group', p) },
    radioGroup(p)    { return makeNode('radio-group', p) },
    button(p)        { return makeNode('button', p) },
    tagList(p)       { return makeNode('tag-list', p) },
    searchInput(p)   { return makeNode('search-input', p) },
  }
}
