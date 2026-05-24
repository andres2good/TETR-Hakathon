# TETR Desktop Client

Controla tu computadora por voz — igual que la app Android controla el celular.

## Instalación

```bash
cd desktop
pip install -r requirements.txt
```

Para que el click-por-texto funcione, instala Tesseract:
- **Linux:** `sudo apt install tesseract-ocr`
- **Mac:** `brew install tesseract`
- **Windows:** https://github.com/UB-Mannheim/tesseract/wiki

## Uso

1. Asegúrate que el servidor TETR esté corriendo:
   ```bash
   cd ../server && npm start
   ```

2. Corre el cliente:
   ```bash
   python main.py
   ```

3. Habla un comando, por ejemplo:
   - *"Open Chrome"*
   - *"Scroll down"*
   - *"Type hello world"*
   - *"Volume up"*

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `TETR_SERVER_URL` | `ws://localhost:3000/ws` | URL del servidor |
| `TETR_APP_KEY` | `tetr-secret-2024-xK9mPqR7` | Clave de autenticación |
