# Sistema de Orçamentos para Construção Civil

Um sistema completo de gestão de orçamentos para licitações, desenvolvido com **React, TypeScript, Vite e TailwindCSS**.

## 🚀 Funcionalidades Incluídas
- **Gerenciamento de Orçamentos**: Criação e edição de planilhas orçamentárias.
- **Banco de Insumos**: Integração preparada para SINAPI, SICRO, etc.
- **Armazenamento Local**: Seus dados ficam salvos no navegador (IndexedDB) para privacidade e velocidade.
- **Responsivo**: Funciona em PC, Tablet e Celular.

## 📦 Como Usar (Instalação Local)

1. Instale as dependências:
   ```bash
   npm install
   ```

2. Rode o servidor de desenvolvimento:
   ```bash
   npm run dev
   ```

3. Acesse `http://localhost:5173`.

## 🌐 Como Hospedar (Deploy Grátis)

Você pode colocar este site no ar gratuitamente em serviços como **Vercel** ou **Netlify**.

### Opção 1: Vercel (Recomendado)
1. Crie uma conta na [Vercel](https://vercel.com).
2. Instale o Vercel CLI: `npm i -g vercel`
3. Na pasta do projeto, rode:
   ```bash
   vercel
   ```
4. Siga as instruções na tela (aceite os padrões).

### Opção 2: Netlify (Arrastar e Soltar)
1. Rode o comando de build:
   ```bash
   npm run build
   ```
2. Uma pasta chamada `dist` será criada.
3. Abra o [Netlify Drop](https://app.netlify.com/drop).
4. Arraste a pasta `dist` para dentro do site.
5. Pronto! Seu site está no ar.


## 🛠️ Detalhes Técnicos
- **Frontend**: React 18 + Vite
- **Estilização**: TailwindCSS
- **Banco de Dados**: Dexie.js (IndexedDB Wrapper)
- **Ícones**: Lucide React
- **Router**: React Router DOM

## 🗄️ Atualização de Bases de Dados
Para atualizar as bases de preços (SINAPI, ORSE, etc.), você pode baixar os arquivos oficiais em Excel e processá-los usando o script incluído:

1. Baixe o arquivo XLSX oficial.
2. Na raiz do projeto, rode:
   ```bash
   node scripts/convert_table.js caminho/para/arquivo.xlsx "NOME_DA_FONTE" public/data/seed-nome.json
   ```
3. O sistema carregará a nova base automaticamente ao clicar em "Sincronizar" na página do Banco de Insumos.

---
Desenvolvido para alta performance e facilidade de deploy.
