import paramiko
import time
from scp import SCPClient
import os

# Configuration
HOST = "92.112.189.44"
PORT = 65002
USERNAME = "u795331143"
PASSWORD = "Abnerisai24."
REMOTE_DIR = "/home/u795331143/domains/weotzi.com/public_html/beta"
NEW_APP_PORT = 4545

def fix_remote_port():
    """
    Fix the remote server by:
    1. Uploading the updated configuration files (.htaccess, proxy.php, ecosystem.config.js)
    2. Stopping existing PM2 processes
    3. Starting the app on port 4545 using ecosystem.config.js
    4. Verifying the fix
    """
    ssh = None
    try:
        print(f"Connecting to {HOST}:{PORT}...")
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(HOST, port=PORT, username=USERNAME, password=PASSWORD)
        print("Connected successfully.")

        # Environment setup for Node.js and PM2
        node_path = "/opt/alt/alt-nodejs22/root/bin"
        env_setup = f"export PATH={node_path}:$PATH && export PM2_HOME=/home/u795331143/.pm2-beta"
        pm2_cmd = "./node_modules/.bin/pm2"

        # Step 1: Upload updated configuration files
        print("\n[Step 1] Uploading configuration files...")
        base_dir = os.path.dirname(os.path.dirname(__file__))
        
        # Upload .htaccess
        htaccess_path = os.path.join(base_dir, "beta.htaccess")
        if os.path.exists(htaccess_path):
            with SCPClient(ssh.get_transport()) as scp:
                scp.put(htaccess_path, remote_path=f"{REMOTE_DIR}/.htaccess")
            print(f"  - Uploaded .htaccess")
        else:
            print(f"  - WARNING: Could not find {htaccess_path}")
        
        # Upload proxy.php
        proxy_path = os.path.join(base_dir, "proxy.php")
        if os.path.exists(proxy_path):
            with SCPClient(ssh.get_transport()) as scp:
                scp.put(proxy_path, remote_path=f"{REMOTE_DIR}/proxy.php")
            print(f"  - Uploaded proxy.php (connecting to port {NEW_APP_PORT})")
        else:
            print(f"  - WARNING: Could not find {proxy_path}")
        
        # Upload ecosystem.config.js
        ecosystem_path = os.path.join(base_dir, "ecosystem.config.js")
        if os.path.exists(ecosystem_path):
            with SCPClient(ssh.get_transport()) as scp:
                scp.put(ecosystem_path, remote_path=f"{REMOTE_DIR}/ecosystem.config.js")
            print(f"  - Uploaded ecosystem.config.js (PM2 config with port {NEW_APP_PORT})")
        else:
            print(f"  - WARNING: Could not find {ecosystem_path}")

        # Step 2: Stop all existing PM2 processes for this app
        print("\n[Step 2] Stopping existing PM2 processes...")
        stop_cmd = f"{env_setup} && cd {REMOTE_DIR} && {pm2_cmd} delete all || echo 'No processes to delete'"
        stdin, stdout, stderr = ssh.exec_command(stop_cmd)
        exit_status = stdout.channel.recv_exit_status()
        stop_out = stdout.read().decode('utf-8', errors='replace').strip()
        stop_err = stderr.read().decode('utf-8', errors='replace').strip()
        print(f"Stop result: {stop_out.encode('ascii', errors='replace').decode()}")
        if stop_err:
            print(f"Stop stderr: {stop_err.encode('ascii', errors='replace').decode()}")

        # Step 3: Kill any lingering node processes on old ports
        print("\n[Step 3] Killing any lingering node processes...")
        kill_cmd = "pkill -f 'node.*server.js' || echo 'No processes to kill'"
        stdin, stdout, stderr = ssh.exec_command(kill_cmd)
        stdout.channel.recv_exit_status()
        kill_out = stdout.read().decode('utf-8', errors='replace').strip()
        print(f"Kill result: {kill_out.encode('ascii', errors='replace').decode()}")

        # Wait a moment for ports to be released
        print("Waiting 3 seconds for ports to release...")
        time.sleep(3)

        # Step 4: Start the application using ecosystem.config.js
        print(f"\n[Step 4] Starting application on port {NEW_APP_PORT} using ecosystem.config.js...")
        start_cmd = f"{env_setup} && cd {REMOTE_DIR} && {pm2_cmd} start ecosystem.config.js"
        stdin, stdout, stderr = ssh.exec_command(start_cmd)
        exit_status = stdout.channel.recv_exit_status()
        out = stdout.read().decode('utf-8', errors='replace').strip()
        err = stderr.read().decode('utf-8', errors='replace').strip()
        print(f"Start output: {out.encode('ascii', errors='replace').decode()}")
        if err:
            print(f"Start stderr: {err.encode('ascii', errors='replace').decode()}")

        # Wait for app to start
        print("Waiting 5 seconds for app to start...")
        time.sleep(5)

        # Step 4b: Save PM2 process list for persistence
        print("\n[Step 4b] Saving PM2 configuration for persistence...")
        save_cmd = f"{env_setup} && cd {REMOTE_DIR} && {pm2_cmd} save"
        stdin, stdout, stderr = ssh.exec_command(save_cmd)
        stdout.channel.recv_exit_status()
        save_out = stdout.read().decode('utf-8', errors='replace').strip()
        print(f"PM2 save: {save_out.encode('ascii', errors='replace').decode()}")

        # Step 5: Verify PM2 status
        print("\n[Step 5] Checking PM2 status...")
        status_cmd = f"{env_setup} && cd {REMOTE_DIR} && {pm2_cmd} list"
        stdin, stdout, stderr = ssh.exec_command(status_cmd)
        stdout.channel.recv_exit_status()
        status_out = stdout.read().decode('utf-8', errors='replace')
        print(status_out.encode('ascii', errors='replace').decode())

        # Step 6: Verify local connectivity
        print(f"\n[Step 6] Testing local connectivity on port {NEW_APP_PORT}...")
        test_cmd = f"curl -s -o /dev/null -w '%{{http_code}}' http://127.0.0.1:{NEW_APP_PORT}/"
        stdin, stdout, stderr = ssh.exec_command(test_cmd)
        stdout.channel.recv_exit_status()
        http_code = stdout.read().decode().strip()
        print(f"Local HTTP response code: {http_code}")

        if http_code in ['200', '302']:
            print(f"\nSUCCESS: Application is running on port {NEW_APP_PORT}")
        else:
            print(f"\nWARNING: Unexpected HTTP code {http_code}. Checking PM2 logs...")
            log_cmd = f"{env_setup} && cd {REMOTE_DIR} && {pm2_cmd} logs weotzi-beta --lines 30 --nostream"
            stdin, stdout, stderr = ssh.exec_command(log_cmd)
            stdout.channel.recv_exit_status()
            log_out = stdout.read().decode('utf-8', errors='replace')
            print(log_out.encode('ascii', errors='replace').decode())

        # Step 7: Test public URL
        print("\n[Step 7] Testing public URL...")
        public_test_cmd = "curl -s -o /dev/null -w '%{http_code}' https://beta.weotzi.com/quotation/"
        stdin, stdout, stderr = ssh.exec_command(public_test_cmd)
        stdout.channel.recv_exit_status()
        public_http_code = stdout.read().decode().strip()
        print(f"Public URL HTTP response code: {public_http_code}")

        if public_http_code in ['200', '302']:
            print("\n" + "="*50)
            print("SUCCESS! The application is now accessible at:")
            print("https://beta.weotzi.com/quotation/")
            print("="*50)
        else:
            print(f"\nPublic URL still returning {public_http_code}. May need time to propagate or check .htaccess.")

        # Show final .htaccess content
        print("\n[Info] Current .htaccess content:")
        stdin, stdout, stderr = ssh.exec_command(f"cat {REMOTE_DIR}/.htaccess")
        stdout.channel.recv_exit_status()
        htaccess_out = stdout.read().decode('utf-8', errors='replace')
        print(htaccess_out)

    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if ssh:
            ssh.close()
            print("\nSSH connection closed.")

if __name__ == "__main__":
    fix_remote_port()
