import * as pdfjsLib from 'pdfjs-dist';

// Configure worker using CDN to avoid Vite build issues
// Using unpkg to ensure we get the worker matching the installed version
// Fallback to a fixed version if pdfjsLib.version is undefined
const version = pdfjsLib.version || '4.8.69';
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;

export const convertPdfToImages = async (pdfUrl, onLog = console.log, onProgress = null) => {
    onLog(`Starting PDF conversion for: ${pdfUrl}`);
    try {
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        onLog("Loading PDF document...");
        const pdf = await loadingTask.promise;
        onLog(`PDF loaded. Pages: ${pdf.numPages}`);

        const numPages = pdf.numPages;

        // Process up to 50 pages as requested
        const pagesToProcess = Math.min(numPages, 50);
        const images = [];

        onLog(`Processing ${pagesToProcess} pages sequentially...`);
        if (onProgress) onProgress(0);

        for (let i = 1; i <= pagesToProcess; i++) {
            // Yield to main thread to prevent freezing
            await new Promise(resolve => setTimeout(resolve, 100));

            onLog(`Reading page ${i}...`);
            try {
                const page = await pdf.getPage(i);

                // Scale 0.85: Balance between resolution and payload size
                const viewport = page.getViewport({ scale: 0.85 });

                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                await Promise.race([
                    page.render({
                        canvasContext: context,
                        viewport: viewport
                    }).promise,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Page render timeout')), 5000))
                ]);

                // Yield again before heavy toDataURL
                await new Promise(resolve => setTimeout(resolve, 50));

                // Quality 0.6: Good enough for text, compressed enough for API
                const base64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
                images.push({
                    inlineData: {
                        data: base64,
                        mimeType: "image/jpeg"
                    }
                });
                onLog(`Page ${i} processed.`);
                if (onProgress) {
                    onProgress(Math.round((i / pagesToProcess) * 100));
                }
            } catch (pageError) {
                console.error(`Error rendering page ${i}:`, pageError);
                onLog(`Error rendering page ${i}: ${pageError.message}`);
            }
        }

        onLog("PDF conversion complete.");
        if (onProgress) onProgress(100);
        return images;
    } catch (error) {
        console.error("Error converting PDF to images:", error);
        onLog(`Error converting PDF: ${error.message}`);
        throw error;
    }
};
