/*
 * Process-wide run state and active broker request tracking.
 *
 * Ctrl+C must be able to stop a foreground npx agent immediately even while a
 * 50-second long-poll is in flight.
 */

export const run = { stopping: false }

const activeRequests = new Set()

export function trackRequest(controller) {
	activeRequests.add(controller)
	return () => activeRequests.delete(controller)
}

export function abortActiveRequests() {
	for (const controller of activeRequests) {
		try {
			controller.abort()
		} catch {
			// already completed/aborted
		}
	}
	activeRequests.clear()
}
