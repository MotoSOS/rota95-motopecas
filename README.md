# ROTA 95 — Supabase + Vercel

Projeto preparado para publicar o site da ROTA 95 na Vercel, sincronizado por GitHub e com base Supabase.

## 1. Supabase

1. Crie um projeto no Supabase.
2. Abra **SQL Editor** e execute `supabase/schema.sql`.
3. Em **Authentication > Providers**, ative Google.
4. Em **Authentication > URL Configuration**, adicione a URL de produção da Vercel e `http://localhost:3000` durante testes.
5. Copie a URL do projeto e a chave pública `anon`/publishable.

## 2. GitHub

Crie um repositório vazio, envie todos os arquivos deste projeto e mantenha a branch principal como `main`.

## 3. Vercel

1. Importe o repositório GitHub na Vercel.
2. Em **Settings > Environment Variables**, adicione:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
3. Faça um novo deploy.

Cada push na branch principal criará uma nova publicação automática.

## Segurança

A chave `anon` é pública e protegida pelas políticas RLS. Nunca coloque `service_role`, chave Asaas ou segredos do Google no HTML. Operações administrativas e pagamentos devem passar por funções do servidor.
