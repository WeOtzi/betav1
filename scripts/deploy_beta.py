import paramiko
import os
import zipfile
import sys
import time
from scp import SCPClient

# Configuration
HOST = "92.112.189.44"
PORT = 65002
USERNAME = "u795331143"
PASSWORD = "Abnerisai24."
REMOTE_DIR = "/home/u795331143/domains/weotzi.com/public_html/beta"
LOCAL_ZIP = "deploy_package.zip"

def create_zip():
    print("Creating deployment package...")
    with zipfile.ZipFile(LOCAL_ZIP, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk('.'):
            # Exclude directories
            if 'node_modules' in dirs:
                dirs.remove('node_modules')
            if '.git' in dirs:
                dirs.remove('.git')
            if 'scripts' in dirs:
                dirs.remove('scripts')
            if '.cursor' in dirs:
                dirs.remove('.cursor')
            
            for file in files:
                if file == LOCAL_ZIP or file.endswith('.py') or file.endswith('.zip') or file == "beta.htaccess":
                    continue
                
                file_path = os.path.join(root, file)
                zipf.write(file_path, arcname=os.path.relpath(file_path, '.'))
    print(f"Package created: {LOCAL_ZIP}")

def deploy():
    try:
        # 1. Create SSH Client
        print(f"Connecting to {HOST}:{PORT}...")
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(HOST, port=PORT, username=USERNAME, password=PASSWORD)
        print("Connected successfully.")

        # 2. Upload Files
        print(f"Uploading {LOCAL_ZIP} to {REMOTE_DIR}...")
        
        # Ensure remote directory exists
        stdin, stdout, stderr = ssh.exec_command(f"mkdir -p {REMOTE_DIR}")
        stdout.channel.recv_exit_status()

        with SCPClient(ssh.get_transport()) as scp:
            scp.put(LOCAL_ZIP, remote_path=f"{REMOTE_DIR}/{LOCAL_ZIP}")
            # Upload .htaccess
            if os.path.exists("beta.htaccess"):
                 scp.put("beta.htaccess", remote_path=f"{REMOTE_DIR}/.htaccess")
                 print("Uploaded .htaccess")

        print("Upload complete.")

        # 3. Remote Commands
        # Add Node.js path explicitly and separate PM2 instance
        node_path = "/opt/alt/alt-nodejs20/root/bin"
        env_setup = f"export PATH={node_path}:$PATH && export PM2_HOME=/home/u795331143/.pm2-beta"
        pm2_cmd = "./node_modules/.bin/pm2"
        
        commands = [
            f"cd {REMOTE_DIR} && unzip -o {LOCAL_ZIP}",
            f"rm {REMOTE_DIR}/{LOCAL_ZIP}",
            # Install dependencies
            f"{env_setup} && cd {REMOTE_DIR} && npm install --production",
            # Install PM2 locally since global is restricted
            f"{env_setup} && cd {REMOTE_DIR} && npm install pm2",
            # Delete existing process to ensure clean state
            f"{env_setup} && cd {REMOTE_DIR} && ({pm2_cmd} delete weotzi-beta || echo 'Process not found, skipping delete')",
            # Start app using local PM2 with PORT 3006 and name weotzi-beta
            f"{env_setup} && cd {REMOTE_DIR} && PORT=3006 {pm2_cmd} start server.js --name 'weotzi-beta' --update-env"
        ]

        for cmd in commands:
            print(f"Executing remote command: {cmd}")
            stdin, stdout, stderr = ssh.exec_command(cmd)
            
            # Wait for command to finish and get output
            exit_status = stdout.channel.recv_exit_status()
            out = stdout.read().decode().strip()
            err = stderr.read().decode().strip()
            
            if out:
                try:
                    print(f"[STDOUT] {out}")
                except UnicodeEncodeError:
                    print(f"[STDOUT] {out.encode('ascii', 'ignore').decode()}")
            if err:
                try:
                    print(f"[STDERR] {err}")
                except UnicodeEncodeError:
                    print(f"[STDERR] {err.encode('ascii', 'ignore').decode()}")
            
            if exit_status != 0:
                print(f"Command failed with exit status {exit_status}")
                if "restart" in cmd:
                    print("Restart failed, attempting start...")
                else:
                    return

        print("\nDeployment completed successfully!")
        print(f"App should be running at https://beta.weotzi.com")

    except Exception as e:
        print(f"Deployment failed: {e}")
    finally:
        if 'ssh' in locals():
            ssh.close()
        # Clean up local zip
        if os.path.exists(LOCAL_ZIP):
            os.remove(LOCAL_ZIP)

if __name__ == "__main__":
    create_zip()
    deploy()
