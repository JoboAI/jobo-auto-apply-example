import { redirect } from 'next/navigation'

/**
 * The apply form moved: it lives in the tutorial's create step until the
 * tutorial is complete, and on the workbench afterwards. The root router
 * knows which — old bookmarks land in the right place either way.
 */
export default function ApplyRedirect() {
  redirect('/')
}
