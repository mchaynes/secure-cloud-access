import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as google from "@pulumi/google-native";
import * as github from "@pulumi/github";
import * as pulumiservice from "@pulumi/pulumiservice";

const config = new pulumi.Config()

const repoFullName = config.require("repoFullName")

const owner = repoFullName.split("/")[0]
const repoName = repoFullName.split("/")[1]

const repo = github.getRepositoryOutput({
  fullName: repoFullName,
})

export const repoUrl = pulumi.interpolate`https://github.com/${repo.fullName}`

const pulumiToken = new pulumiservice.AccessToken("github-actions-token", {
  description: pulumi.interpolate`token for ${repoUrl}`,
})

new github.ActionsSecret("pulumiToken", {
  repository: repoName,
  secretName: "PULUMI_ACCESS_TOKEN",
  plaintextValue: pulumiToken.value.apply(f => f ?? ""),
})

const name = "github-actions"

const serviceAccount = new google.iam.v1.ServiceAccount(name, {
    accountId: "github-actions"
})

new gcp.projects.IAMMember("github-actions", {
    role: "roles/viewer",
    member: pulumi.interpolate`serviceAccount:${serviceAccount.email}`
})

const identityPool = new gcp.iam.WorkloadIdentityPool("github-actions", {
  disabled: false,
  workloadIdentityPoolId: `${name}-4`,
});

const identityPoolProvider = new gcp.iam.WorkloadIdentityPoolProvider(
  "github-actions",
  {
    workloadIdentityPoolId: identityPool.workloadIdentityPoolId,
    workloadIdentityPoolProviderId: `${name}`,
    oidc: {
      issuerUri: "https://token.actions.githubusercontent.com",
    },
    attributeMapping: {
      "google.subject": "assertion.sub",
      "attribute.actor": "assertion.actor",
      "attribute.repository": "assertion.repository",
    },
  }
);

new gcp.serviceaccount.IAMMember("repository", {
    serviceAccountId: serviceAccount.name,
    role: "roles/iam.workloadIdentityUser",
    member: pulumi.interpolate`principalSet://iam.googleapis.com/${identityPool.name}/attribute.repository/${repoFullName}`
})

new github.ActionsSecret("identityProvider", {
    repository: "secure-cloud-access",
    secretName: "WORKLOAD_IDENTITY_PROVIDER",
    plaintextValue: identityPoolProvider.name,
  });

  new github.ActionsSecret("subscriptionId", {
    repository: "secure-cloud-access",
    secretName: "SERVICE_ACCOUNT_EMAIL",
    plaintextValue: serviceAccount.email,
  });

export const workloadIdentityProviderUrl = identityPoolProvider.name
export const serviceAccountEmail = serviceAccount.email
