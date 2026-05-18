import { migrate } from './schema'

export type Sql = InstanceType<typeof Bun.SQL>

export async function connectDatabase(url: string): Promise<Sql> {
  const sql = new Bun.SQL(url)
  await migrate(sql)
  return sql
}
