import os
import shutil
import tempfile
import requests
import time
import logging
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import JSONResponse
import pytesseract
from pdf2image import convert_from_path

# Configure Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger("ocr_service")

app = FastAPI(title="NaboOrca OCR Service")
executor = ThreadPoolExecutor(max_workers=3) # Limit concurrency for t3.micro

def run_cpu_bound(func, *args, **kwargs):
    return func(*args, **kwargs)

@app.get("/health")
def health():
    return {"status": "ok", "service": "naborca-ocr-tesseract"}

@app.post("/ocr")
async def process_ocr(
    file: UploadFile = File(None),
    url: str = Form(None)
):
    if not file and not url:
        raise HTTPException(status_code=400, detail="Must provide 'file' or 'url'")

    request_id = str(int(time.time()))
    logger.info(f"[{request_id}] Starting OCR request")

    temp_dir = tempfile.mkdtemp()
    temp_pdf_path = os.path.join(temp_dir, "input.pdf")

    try:
        # 1. Get Content
        logger.info(f"[{request_id}] Downloading/Saving content...")
        if file:
            with open(temp_pdf_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
        else:
            if not url.startswith("http"):
                raise HTTPException(status_code=400, detail="Invalid URL")
            with requests.get(url, stream=True) as r:
                r.raise_for_status()
                with open(temp_pdf_path, "wb") as f:
                    for chunk in r.iter_content(chunk_size=8192):
                        f.write(chunk)

        # 2. PDF to Image (CPU Bound -> ThreadPool)
        logger.info(f"[{request_id}] Converting PDF to images...")
        pages = await app.loop.run_in_executor(executor, convert_from_path, temp_pdf_path)
        
        page_count = len(pages)
        logger.info(f"[{request_id}] PDF has {page_count} pages")

        if page_count > 30:
            raise HTTPException(status_code=400, detail=f"PDF too large ({page_count} pages). Max allowed is 30.")

        # 3. OCR (CPU Bound -> ThreadPool per page)
        logger.info(f"[{request_id}] Starting OCR extraction...")
        full_text = []
        
        for i, page in enumerate(pages):
            logger.info(f"[{request_id}] Processing page {i+1}/{page_count}")
            # Run pytesseract in thread pool to avoid blocking
            text = await app.loop.run_in_executor(executor, pytesseract.image_to_string, page, 'por')
            full_text.append(text)

        joined_text = "\n".join(full_text)
        logger.info(f"[{request_id}] OCR Complete. Total length: {len(joined_text)}")

        return {
            "text": joined_text,
            "page_count": page_count,
            "info": {
                "method": "tesseract-local",
                "pages_processed": page_count,
                "request_id": request_id
            }
        }

    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"[{request_id}] Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
