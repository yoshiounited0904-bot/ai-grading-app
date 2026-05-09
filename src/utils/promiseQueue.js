/**
 * A simple utility to run asynchronous tasks sequentially.
 * This prevents rate-limiting issues when running multiple heavy AI prompts concurrently.
 */
class PromiseQueue {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
    }

    /**
     * Add a task to the queue. The task must be a function returning a Promise.
     * Returns a Promise that resolves or rejects with the result of the task.
     * 
     * @param {Function} taskFn - The async function to execute
     * @returns {Promise} - Resolves when the task is done
     */
    async add(taskFn) {
        return new Promise((resolve, reject) => {
            this.queue.push(async () => {
                try {
                    const result = await taskFn();
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            });
            
            if (!this.isProcessing) {
                this.processQueue();
            }
        });
    }

    async processQueue() {
        this.isProcessing = true;
        while (this.queue.length > 0) {
            // Take the oldest task from the queue
            const task = this.queue.shift();
            try {
                await task();
            } catch (err) {
                console.error("[PromiseQueue] Task failed:", err);
                // Continue processing other tasks even if one fails
            }
        }
        this.isProcessing = false;
    }
}

// Export a singleton instance to be shared across the application
export const geminiQueue = new PromiseQueue();
