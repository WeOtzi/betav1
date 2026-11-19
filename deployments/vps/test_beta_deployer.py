"""Pruebas de la lógica del deployer (sin Docker ni red). Correr en Linux:
    python3 -m unittest deployments/vps/test_beta_deployer.py -v
"""
import importlib.util
import json
import os
import pathlib
import tempfile
import unittest
from unittest import mock

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("beta_deployer", HERE / "beta-deployer.py")
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)

A, B, C = "a" * 40, "b" * 40, "c" * 40
DA, DB, DC = "sha256:" + "1" * 64, "sha256:" + "2" * 64, "sha256:" + "3" * 64
IMG = d.IMAGE


def ref(digest):
    return f"{IMG}@{digest}"


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        patcher = mock.patch.multiple(d, STATE_DIR=self.tmp.name, LOG_FILE=os.path.join(self.tmp.name, "log"),
                                      HEALTH_DELAY=0, HEALTH_ATTEMPTS=2)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.tmp.cleanup)
        self.service = {"image": ref(DA)}
        self.live = {"commit": A}
        self.updates = []

        def update_service(image_ref):
            self.updates.append(image_ref)
            self.service["image"] = image_ref
            for sha, digest in ((A, DA), (B, DB), (C, DC)):
                if d.digest_of(image_ref) == digest:
                    self.live["commit"] = self.health.get(sha, sha)
            return True

        self.health = {}  # sha -> commit que responde (para simular fallas)
        for name, value in {
            "service_exists": lambda: True,
            "service_image": lambda: self.service["image"],
            "update_service": update_service,
            "release_info": lambda: {"ok": True, "commit": self.live["commit"], "version": "9.9.9"},
            "prune_images": lambda refs: None,
        }.items():
            p = mock.patch.object(d, name, side_effect=value) if callable(value) else None
            p.start()
            self.addCleanup(p.stop)

    def state(self):
        return d.load_state()

    def seed(self, **state):
        d.save_state({"current": {"sha": A, "image": ref(DA)}, **state})


class PollTests(Base):
    def test_sin_adopt_no_publica(self):
        with mock.patch.object(d, "main_tip", return_value=B):
            self.assertEqual(d.poll(None), 0)
        self.assertEqual(self.updates, [])

    def test_publica_la_punta_verificada_por_digest(self):
        self.seed()
        with mock.patch.object(d, "main_tip", return_value=B), \
             mock.patch.object(d, "ci_passed", return_value=True), \
             mock.patch.object(d, "published_digest", return_value=DB), \
             mock.patch.object(d, "pull_digest", return_value=ref(DB)):
            self.assertEqual(d.poll(None), 0)
        st = self.state()
        self.assertEqual(st["current"]["sha"], B)
        self.assertEqual(st["current"]["image"], ref(DB))
        self.assertEqual(st["previous"]["sha"], A)
        self.assertEqual(self.updates, [ref(DB)])

    def test_ci_pendiente_reintenta_con_espera_creciente(self):
        self.seed()
        with mock.patch.object(d, "main_tip", return_value=B), mock.patch.object(d, "ci_passed", return_value=False):
            attempts = []
            for _ in range(7):
                d.poll(None)
                st = self.state()
                attempts.append(st["retry"]["attempts"])
                st["retry"]["until"] = "2000-01-01T00:00:00Z"  # forzar que venza la espera
                d.save_state(st)
            # Mientras la espera no vence, no consulta nada.
            st = self.state()
            st["retry"]["until"] = "2999-01-01T00:00:00Z"
            d.save_state(st)
            with mock.patch.object(d, "ci_passed", side_effect=AssertionError("no debía consultar")):
                self.assertEqual(d.poll(None), 0)
        self.assertEqual(attempts, [1, 2, 3, 4, 5, 6, 7])
        self.assertEqual(self.updates, [])

    def test_espera_crece_hasta_quince_minutos(self):
        st = {}
        for _ in range(30):
            d.schedule_retry(st, B, "x")
        self.assertEqual(st["retry"]["attempts"], 30)
        until = d.dt.datetime.strptime(st["retry"]["until"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=d.dt.timezone.utc)
        self.assertLessEqual((until - d.now()).total_seconds(), 901)

    def test_salud_falla_bloquea_y_vuelve_a_la_anterior(self):
        self.seed()
        self.health[B] = A  # B no llega a responder con su commit
        with mock.patch.object(d, "main_tip", return_value=B), \
             mock.patch.object(d, "ci_passed", return_value=True), \
             mock.patch.object(d, "published_digest", return_value=DB), \
             mock.patch.object(d, "pull_digest", return_value=ref(DB)):
            self.assertEqual(d.poll(None), 1)
            self.assertEqual(self.updates, [ref(DB), ref(DA)])
            st = self.state()
            self.assertEqual(st["blocked"]["sha"], B)
            self.assertEqual(st["current"]["sha"], A)
            self.updates.clear()
            self.assertEqual(d.poll(None), 0)  # bloqueado: no reintenta
            self.assertEqual(self.updates, [])

    def test_update_que_no_aplica_reintenta_sin_bloquear(self):
        self.seed()
        with mock.patch.object(d, "main_tip", return_value=B), \
             mock.patch.object(d, "ci_passed", return_value=True), \
             mock.patch.object(d, "published_digest", return_value=DB), \
             mock.patch.object(d, "pull_digest", return_value=ref(DB)), \
             mock.patch.object(d, "update_service", return_value=False):
            self.assertEqual(d.poll(None), 1)
        st = self.state()
        self.assertNotIn("blocked", st)
        self.assertEqual(st["retry"]["sha"], B)
        self.assertEqual(st["current"]["sha"], A)

    def test_deriva_vuelve_a_fijar_la_imagen_registrada(self):
        self.seed(blocked={"sha": B})
        self.service["image"] = f"{IMG}:main@{DB}"  # alguien hizo «Deploy» en el panel
        self.live["commit"] = B
        with mock.patch.object(d, "main_tip", return_value=B):
            self.assertEqual(d.poll(None), 0)
        self.assertEqual(self.updates, [ref(DA)])
        self.assertEqual(self.live["commit"], A)

    def test_main_por_digest_igual_no_es_deriva(self):
        self.seed()
        self.service["image"] = f"{IMG}:main@{DA}"
        with mock.patch.object(d, "main_tip", return_value=A):
            self.assertEqual(d.poll(None), 0)
        self.assertEqual(self.updates, [])


class ManualTests(Base):
    def test_rollback_manual_bloquea_la_punta_y_no_ofrece_volver(self):
        d.save_state({"current": {"sha": B, "image": ref(DB)}, "previous": {"sha": A, "image": ref(DA)}})
        self.live["commit"] = B
        with mock.patch.object(d, "main_tip", return_value=B):
            self.assertEqual(d.rollback(mock.Mock(sha=None)), 0)
        st = self.state()
        self.assertEqual(st["current"]["sha"], A)
        self.assertEqual(st["blocked"]["sha"], B)
        self.assertIsNone(st["previous"])
        with self.assertRaises(d.DeployError):
            d.rollback(mock.Mock(sha=None))

    def test_deploy_manual_de_un_commit_viejo_bloquea_la_punta(self):
        self.seed()
        with mock.patch.object(d, "main_tip", return_value=C), \
             mock.patch.object(d, "verified_reference", return_value=ref(DB)):
            self.assertEqual(d.deploy(mock.Mock(sha=B)), 0)
        st = self.state()
        self.assertEqual(st["current"]["sha"], B)
        self.assertEqual(st["blocked"]["sha"], C)

    def test_adopt_fija_por_digest(self):
        self.service["image"] = f"{IMG}:main"
        self.live["commit"] = A
        with mock.patch.object(d, "verified_reference", return_value=ref(DA)):
            self.assertEqual(d.adopt(None), 0)
        self.assertEqual(self.state()["current"]["image"], ref(DA))
        self.assertEqual(self.updates, [ref(DA)])


class StateAndGithubTests(unittest.TestCase):
    def test_state_corrupto_se_aparta(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.multiple(d, STATE_DIR=tmp, LOG_FILE=os.path.join(tmp, "log")):
            pathlib.Path(tmp, "state.json").write_text("{roto", encoding="utf-8")
            self.assertEqual(d.load_state(), {})
            self.assertTrue(any(name.startswith("state.json.corrupt-") for name in os.listdir(tmp)))

    def fake_github(self, publish_conclusion="success", annotation=DB):
        def github_json(url):
            if "publish-image.yml/runs" in url:
                return {"workflow_runs": [{"head_sha": B, "head_branch": "main", "event": "workflow_run",
                                           "path": ".github/workflows/publish-image.yml", "status": "completed",
                                           "conclusion": publish_conclusion, "jobs_url": "https://x/jobs", "id": 1,
                                           "created_at": "2026-11-19T00:00:00Z"}]}
            if url.startswith("https://x/jobs"):
                return {"jobs": [{"name": d.PUBLISH_JOB, "head_sha": B, "status": "completed",
                                  "conclusion": "success", "id": 77}]}
            if "/check-runs/77/annotations" in url:
                return [{"title": "otra", "message": DC}, {"title": d.DIGEST_ANNOTATION, "message": annotation}]
            raise AssertionError(url)
        return github_json

    def test_digest_sale_de_la_anotacion_del_job_oficial(self):
        with mock.patch.object(d, "github_json", side_effect=self.fake_github()):
            self.assertEqual(d.published_digest(B), DB)

    def test_publicacion_fallida_o_sin_anotacion_no_se_despliega(self):
        with mock.patch.object(d, "github_json", side_effect=self.fake_github(publish_conclusion="failure")):
            with self.assertRaises(d.DeployError):
                d.published_digest(B)
        with mock.patch.object(d, "github_json", side_effect=self.fake_github(annotation="latest")):
            with self.assertRaises(d.DeployError):
                d.published_digest(B)


if __name__ == "__main__":
    unittest.main()
