import { DurableObject } from "cloudflare:workers"

/**
 * Registry for local computer agents.
 *
 * Device/job execution state itself lives in EnvDO. This singleton only keeps
 * the discoverable list of computers and their last contact time.
 */
export class GuardDO extends DurableObject {
	private get sql() {
		return this.ctx.storage.sql
	}

	private init() {
		this.sql.exec(`CREATE TABLE IF NOT EXISTS devices (
			env_id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			platform TEXT NOT NULL,
			registered_at INTEGER NOT NULL,
			last_seen INTEGER NOT NULL,
			metadata TEXT
		)`)
	}

	async registerDevice(input: {
		envId: string
		name: string
		platform: string
		metadata?: Record<string, unknown>
	}): Promise<void> {
		this.init()
		const now = Date.now()
		this.sql.exec(
			`INSERT INTO devices (env_id,name,platform,registered_at,last_seen,metadata)
			 VALUES (?,?,?,?,?,?)
			 ON CONFLICT(env_id) DO UPDATE SET
			   name=excluded.name,
			   platform=excluded.platform,
			   last_seen=excluded.last_seen,
			   metadata=excluded.metadata`,
			input.envId,
			input.name,
			input.platform,
			now,
			now,
			JSON.stringify(input.metadata || {}),
		)
	}

	async touchDevice(envId: string): Promise<void> {
		this.init()
		this.sql.exec(`UPDATE devices SET last_seen = ? WHERE env_id = ?`, Date.now(), envId)
	}

	async removeDevice(envId: string): Promise<void> {
		this.init()
		this.sql.exec(`DELETE FROM devices WHERE env_id = ?`, envId)
	}

	async listDevices(): Promise<Array<{
		env_id: string
		name: string
		platform: string
		registered_at: number
		last_seen: number
		metadata: Record<string, unknown>
	}>> {
		this.init()
		const rows = this.sql.exec(
			`SELECT env_id,name,platform,registered_at,last_seen,metadata
			 FROM devices ORDER BY last_seen DESC`,
		).toArray() as any[]
		return rows.map((r) => {
			let metadata: Record<string, unknown> = {}
			try { metadata = JSON.parse(String(r.metadata || "{}")) } catch {}
			return {
				env_id: String(r.env_id),
				name: String(r.name),
				platform: String(r.platform),
				registered_at: Number(r.registered_at),
				last_seen: Number(r.last_seen),
				metadata,
			}
		})
	}
}
