# Etapa 8 — Preparação para backend

## Objetivo
Esta etapa prepara a base modular para sair do modo 100% local e evoluir para API/backend real.

## Novos módulos
- `backend-config.js`: carrega e salva a configuração da API
- `http.js`: cliente HTTP com timeout e tenant header
- `backend-status.js`: painel de status, checklist e healthcheck
- `services/auth-service.js`
- `services/product-service.js`
- `services/sales-service.js`
- `services/payment-service.js`
- `services/company-service.js`

## Estratégia atual
A base trabalha com **fallback local**:
- se a API não estiver pronta, o sistema continua funcionando localmente
- quando o modo backend for ativado e a API responder, os serviços podem assumir gradualmente

## Endpoints sugeridos
- `GET /health`

### Autenticação
- `POST /v1/auth/login`
- `POST /v1/auth/register`
- `POST /v1/auth/verify-email`
- `POST /v1/auth/resend-verification`

### Produtos
- `GET /v1/products`
- `PUT /v1/products/bulk`

### Vendas
- `GET /v1/sales`
- `PUT /v1/sales/bulk`

### Pagamentos
- `GET /v1/payments/settings`
- `PUT /v1/payments/settings`

### Empresa
- `GET /v1/companies/settings`
- `PUT /v1/companies/settings`

## Próxima etapa possível
- substituir persistência local dos módulos por chamadas aos serviços
- introduzir token JWT / refresh token
- separar empresas por tenant real no backend
- adicionar fluxo de recuperação de senha
- tratar contas pendentes de verificação com reenvio automático de código