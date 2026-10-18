import { DOMExtensionContext } from 'bike/dom'
import { createRoot } from 'react-dom/client'
import { BacklinksView } from './lib/View'
import { BacklinksProtocol } from './lib/protocol'

export function activate(context: DOMExtensionContext<BacklinksProtocol>) {
  createRoot(context.element).render(<BacklinksView context={context} />)
}
