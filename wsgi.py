# Entrada para servidores de produção (PythonAnywhere, gunicorn, uWSGI...).
# Exemplo: gunicorn wsgi:application
from league import criar_app

application = criar_app()
