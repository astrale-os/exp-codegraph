import { applyJobEvent } from '../api.js'

const running = applyJobEvent('pending', 'start')
void running
