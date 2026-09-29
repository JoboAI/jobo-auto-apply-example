import { db } from '../db/client'
import { user } from '../db/schema'
db.select().from(user).limit(1).all()
console.log('Database migrations complete.')
