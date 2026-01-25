# Guia de Deploy: OCR Próprio na AWS (Sem CLI)

Este guia descreve o passo a passo para subir o microserviço de OCR (Tesseract) em uma EC2 Free Tier e integrar ao Supabase de forma segura e econômica.

## Parte 1: Criação da Instância EC2 (AWS Console)

1.  Acesse o [AWS Console](https://console.aws.amazon.com/ec2).
2.  Região: **Ohio (us-east-2)**.
3.  **Launch Instance**.
    *   Name: `naborca-ocr`
    *   AMI: **Ubuntu Server 22.04 LTS (HVM)** (Free Tier).
    *   Instance Type: **t3.micro** (Free Tier).
    *   *Nota: Se precisar de mais poder, mude para `t3.small` (aprox. USD 20/mês). O Free Tier atende PDFs pequenos e médios (< 30 págs).*
4.  **Key Pair (Login)**:
    *   Create new key pair > Name: `naborca-ocr-key` > Format: `.pem`.
    *   Baixe e guarde o arquivo `.pem`.
5.  **Network Settings (Security Group)** - **IMPORTANTE**:
    *   Marque "Create security group".
    *   **SSH**: Allow SSH traffic from **My IP** (ou Temporariamente 0.0.0.0/0, mas remova depois).
    *   **HTTP**: Allow HTTP traffic from the internet (0.0.0.0/0).
    *   **NÃO** abra a porta 8080 para o mundo. Usaremos a porta 80 padrão que é mais segura e amigável, mapeando internamente.
6.  **Storage**: Padrão (8 GiB).
7.  **Launch Instance**.
8.  Copie o **Public IPv4 address**.

## Parte 2: Acesso SSH

No terminal da sua máquina (onde está o `.pem`):

```powershell
ssh -i "naborca-ocr-key.pem" ubuntu@<IP_PUBLICO>
```

## Parte 3: Instalação e Execução (Na EC2)

Execute sequencialmente no terminal SSH:

### 1. Instalar Docker
```bash
sudo apt-get update
sudo apt-get install -y docker.io
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker ubuntu
```
*(Saia e entre do SSH para aplicar o grupo docker, ou use `sudo docker` nos comandos abaixo).*

### 2. Criar Arquivos
Copie e cole os blocos abaixo para criar os arquivos na EC2.

**`mkdir app && cd app`**

**`Dockerfile`**:
```bash
cat <<EOF > Dockerfile
FROM python:3.9-slim
RUN apt-get update && apt-get install -y tesseract-ocr tesseract-ocr-por poppler-utils curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
EOF
```

**`requirements.txt`**:
```bash
cat <<EOF > requirements.txt
fastapi
uvicorn
python-multipart
requests
pytesseract
pdf2image
EOF
```

**`main.py`** (Atualizado com Logs e ThreadPool):
*(Use `nano main.py`, delete tudo antigo, cole o código novo abaixo, Ctrl+O, Enter, Ctrl+X)*
```python
import os
import shutil
import tempfile
import requests
import time
import logging
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
import pytesseract
from pdf2image import convert_from_path

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger("ocr_service")

app = FastAPI(title="NaboOrca OCR Service")
executor = ThreadPoolExecutor(max_workers=3)

@app.get("/health")
def health():
    return {"status": "ok", "service": "naborca-ocr-tesseract"}

@app.post("/ocr")
async def process_ocr(file: UploadFile = File(None), url: str = Form(None)):
    if not file and not url:
        raise HTTPException(status_code=400, detail="Must provide 'file' or 'url'")

    request_id = str(int(time.time()))
    logger.info(f"[{request_id}] Starting OCR request")
    temp_dir = tempfile.mkdtemp()
    temp_pdf_path = os.path.join(temp_dir, "input.pdf")

    try:
        logger.info(f"[{request_id}] Downloading content...")
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

        logger.info(f"[{request_id}] Converting PDF to images...")
        pages = await app.loop.run_in_executor(executor, convert_from_path, temp_pdf_path)
        page_count = len(pages)
        logger.info(f"[{request_id}] PDF has {page_count} pages")

        if page_count > 30:
            raise HTTPException(status_code=400, detail=f"PDF too large ({page_count} pages). Max allowed is 30.")

        logger.info(f"[{request_id}] Starting OCR extraction...")
        full_text = []
        for i, page in enumerate(pages):
            logger.info(f"[{request_id}] Processing page {i+1}/{page_count}")
            text = await app.loop.run_in_executor(executor, pytesseract.image_to_string, page, 'por')
            full_text.append(text)

        joined_text = "\n".join(full_text)
        logger.info(f"[{request_id}] OCR Complete. Len: {len(joined_text)}")

        return {
            "text": joined_text,
            "page_count": page_count,
            "info": {"method": "tesseract-local", "pages_processed": page_count, "request_id": request_id}
        }
    except Exception as e:
        logger.error(f"[{request_id}] Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(temp_dir): shutil.rmtree(temp_dir)
```

### 3. Build e Run (Produção)

Se já houver container rodando, pare e remova antes de rodar o novo:
```bash
sudo docker stop naborca-ocr
sudo docker rm naborca-ocr
```

Agora construa e rode a nova versão:
```bash
# Build
sudo docker build -t naborca-ocr .

# Run (Porta 80 -> 8080)
sudo docker run -d --name naborca-ocr --restart=always -p 80:8080 naborca-ocr
```

Acompanhe os logs para validar o processamento:
```bash
sudo docker logs -f naborca-ocr
```

### 4. Validar

**Na EC2 (interno):**
```bash
curl http://localhost/health
```

**No seu PC (externo):**
```bash
curl http://<IP_PUBLICO>/health
```

---

## Parte 4: Atualização no Supabase

Se você já tinha configurado, apenas atualize o timeout da Edge Function.

**Via CLI:**
```powershell
npx supabase secrets set OCR_SERVICE_TIMEOUT_MS=600000
npx supabase functions deploy import-parse-worker --no-verify-jwt
```
*(Isso aumenta o timeout do worker de 2 para 10 minutos, alinhado com o processamento mais lento de PDFs maiores).*
