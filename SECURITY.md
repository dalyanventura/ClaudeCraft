# Politique de sécurité

## Signaler une vulnérabilité

Merci de **ne pas** ouvrir d'issue publique pour une faille de sécurité.
Utilisez le signalement privé de GitHub : onglet **Security** du dépôt, puis
**Report a vulnerability**.

## Mesures en place

- La branche `main` est protégée : modifications uniquement par pull request
  (fusion en squash), avec l'approbation du propriétaire du code.
- Chaque pull request passe les tests unitaires, un audit npm, une analyse Trivy
  (CVE, secrets, configuration), une analyse CodeQL et une revue des dépendances.
- Dependabot propose automatiquement les mises à jour de sécurité.
- Les GitHub Actions sont épinglées sur un commit précis.
