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
- `POST /auth/login`
- `POST /auth/register`
- `POST /auth/verification-code`
- `GET /auth/health`
- `GET /products`
- `PUT /products/bulk`
- `GET /sales`
- `PUT /sales/bulk`
- `GET /payments/settings`
- `PUT /payments/settings`
- `GET /companies/settings`
- `PUT /companies/settings`

## Próxima etapa possível
- substituir persistência local dos módulos por chamadas aos serviços
- introduzir token JWT / refresh token
- separar empresas por tenant real no backend
