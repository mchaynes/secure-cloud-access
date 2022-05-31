import * as pulumi from "@pulumi/pulumi"
import * as aws from "@pulumi/aws";
import * as github from "@pulumi/github"
import * as pulumiservice from '@pulumi/pulumiservice'

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

const oidcProvider = new aws.iam.OpenIdConnectProvider("secure-cloud-access", {
  thumbprintLists: ["6938fd4d98bab03faadb97b34396831e3780aea1"],
  clientIdLists: [pulumi.interpolate`"https://github.com/${owner}`, "sts.amazonaws.com"],
  url: "https://token.actions.githubusercontent.com",
});

const role = new aws.iam.Role("secure-cloud-access", {
  description: pulumi.interpolate`"Access for ${repoUrl}`,
  assumeRolePolicy: {
    Version: "2012-10-17",
    Statement: [
      {
        Action: ["sts:AssumeRoleWithWebIdentity"],
        Effect: "Allow",
        Condition: {
          StringLike: {
            "token.actions.githubusercontent.com:sub":
              pulumi.interpolate`repo:${repo.fullName}:*`,
          },
        },
        Principal: {
          Federated: [oidcProvider.arn],
        },
      },
    ],
  } as aws.iam.PolicyDocument,
});

const partition = aws.getPartition();

partition.then((p) => {
  new aws.iam.PolicyAttachment("readOnly", {
    policyArn: `arn:${p.partition}:iam::aws:policy/ReadOnlyAccess`,
    roles: [role.name],
  });
});

new github.ActionsSecret("roleArn", {
  repository: repoName,
  secretName: "ROLE_ARN",
  plaintextValue: role.arn,
});

new github.ActionsSecret("pulumiToken", {
  repository: repoName,
  secretName: "PULUMI_ACCESS_TOKEN",
  plaintextValue: pulumiToken.value.apply(f => f ?? ""),
})

export const roleArn = role.arn;
