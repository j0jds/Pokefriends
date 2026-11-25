import os
import sys

from league import criar_app

if __name__ == "__main__":
    try:
        app = criar_app()
    except RuntimeError as e:  # ex.: falta a ADMIN_SENHA
        sys.exit(str(e))
    host = os.environ.get("HOST", "127.0.0.1")  # use HOST=0.0.0.0 para abrir na sua rede local
    print(f"Liga Pokémon rodando em http://localhost:{app.config['PORTA']}")
    app.run(host=host, port=app.config["PORTA"], debug=False)
