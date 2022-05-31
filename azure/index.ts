import * as pulumi from "@pulumi/pulumi";
import * as authorization from "@pulumi/azure-native/authorization";
import * as azuread from "@pulumi/azuread";
import * as github from "@pulumi/github";
import * as pulumiservice from "@pulumi/pulumiservice";
import * as helpers from "./azureHelpers";

const config = new pulumi.Config()

const repoFullName = config.require("repoFullName")

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

// create an azure AD application
const adApp = new azuread.Application("gha", {
  displayName: "githubActions",
});

// create a service principal
const adSp = new azuread.ServicePrincipal(
  "ghaSp",
  { applicationId: adApp.applicationId },
  { parent: adApp }
);

// mandatory SP password
const adSpPassword = new azuread.ServicePrincipalPassword(
  "aksSpPassword",
  {
    servicePrincipalId: adSp.id,
    endDate: "2099-01-01T00:00:00Z",
  },
  { parent: adSp }
);

/*
 * This is the magic. We set the subject to the repo we're running from
 * Also need to ensure your AD Application is the one where access is defined
 */
new azuread.ApplicationFederatedIdentityCredential(
  "gha",
  {
    audiences: ["api://AzureADTokenExchange"],
    subject: `repo:${repoFullName}:ref:refs/heads/main`, // this can be any ref
    issuer: "https://token.actions.githubusercontent.com",
    applicationObjectId: adApp.objectId,
    displayName: "github-actions",
  },
  { parent: adApp }
);

// retrieve the current tenant and subscription
const subInfo = authorization.getClientConfig();

subInfo.then((info) => {

  // define some github actions secrets so your AZ login is correct
  new github.ActionsSecret("tenantId", {
    repository: repoName,
    secretName: "AZURE_TENANT_ID",
    plaintextValue: info.tenantId,
  });

  new github.ActionsSecret("subscriptionId", {
    repository: repoName,
    secretName: "AZURE_SUBSCRIPTION_ID",
    plaintextValue: info.subscriptionId,
  });


  /* define a role assignment so we have permissions on the subscription
   * We use the helper to get the role by name, but you can of course define it explicitly
   */
  new authorization.RoleAssignment("readOnly", {
    principalId: adSp.id,
    principalType: authorization.PrincipalType.ServicePrincipal,
    scope: pulumi.interpolate`/subscriptions/${info.subscriptionId}`,
    roleDefinitionId: helpers.getRoleIdByName("Reader"),
  });
});

// finally, we set the client id to be the application we created
new github.ActionsSecret("clientId", {
  repository: repoName,
  secretName: "AZURE_CLIENT_ID",
  plaintextValue: adApp.applicationId,
});
